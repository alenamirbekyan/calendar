const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

// Chargement du fichier .env s'il existe (fonction native de Node >= 20.12)
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // pas de fichier .env : on utilise les variables d'environnement existantes
}

const bdd = require('./src/bdd');
const comptes = require('./src/comptes');
const stockage = require('./src/stockage');
const dates = require('./src/dates');
const images = require('./src/images');
const limiteConnexion = require('./src/limiteConnexion');
const { verifierMotDePasse, hacherMotDePasse } = require('./src/motsDePasse');
const PGStore = require('connect-pg-simple')(session);

const PORT = Number(process.env.PORT) || 3000;
const DOSSIER_PUBLIC = path.join(__dirname, 'public');

let secretDeSession = process.env.SESSION_SECRET;
if (!secretDeSession) {
  secretDeSession = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET absent : secret temporaire généré (les sessions sautent au redémarrage).');
}

// À activer quand le site est servi en HTTPS derrière un proxy ou un tunnel :
// le cookie de session n'est alors envoyé qu'en HTTPS.
const derriereProxyHttps = process.env.TRUST_PROXY === '1';

const app = express();
app.disable('x-powered-by');
if (derriereProxyHttps) {
  app.set('trust proxy', 1);
}
app.use(express.json());

// Les adresses contiennent des jetons secrets : on ne les transmet à aucun autre site
// et on demande aux moteurs de recherche de ne rien indexer.
app.use((req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

app.use(
  session({
    // Sessions en base : elles survivent aux redémarrages du serveur
    store: new PGStore({ pool: bdd.pool, tableName: 'sessions', createTableIfMissing: true }),
    secret: secretDeSession,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: derriereProxyHttps, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

// ---------- Fichiers statiques ----------

app.use(express.static(DOSSIER_PUBLIC));
// Les noms de fichiers sont des UUID : impossible de deviner l'image d'une case encore fermée.
app.use('/uploads', express.static(images.DOSSIER_IMAGES, { maxAge: '7d' }));

// La page du calendrier contient {{ORIGINE}} : les messageries exigent une adresse
// complète (https://site/...) pour l'image d'aperçu du lien.
const MODELE_PAGE_CALENDRIER = fs.readFileSync(path.join(DOSSIER_PUBLIC, 'calendrier.html'), 'utf8');

// balisesEnPlus : HTML ajouté dans <head> à la place de {{BALISES_PAGE}}
function envoyerPageCalendrier(req, res, balisesEnPlus) {
  const origine = `${req.protocol}://${req.get('host')}`;
  const page = MODELE_PAGE_CALENDRIER.replaceAll('{{ORIGINE}}', origine).replace('{{BALISES_PAGE}}', balisesEnPlus);
  // Jamais de copie en cache : hors connexion, le navigateur ressortirait une page sans style
  // au lieu de la page d'excuse du service worker
  res.set('Cache-Control', 'no-store');
  res.type('html').send(page);
}

// Page d'un destinataire : le jeton de l'URL est la seule clé d'entrée.
// Chaque lien a son propre manifeste, pour que l'application installée rouvre SON calendrier.
app.get('/c/:jeton', (req, res) => {
  let balises = '';
  if (stockage.jetonValide(req.params.jeton)) {
    balises = `<link rel="manifest" href="/c/${req.params.jeton}/manifest.webmanifest">`;
  }
  envoyerPageCalendrier(req, res, balises);
});

// Aperçu admin : même page, sans manifeste (rien à installer), données réservées au propriétaire
app.get('/apercu/:id', (req, res) => {
  envoyerPageCalendrier(req, res, '');
});

// Manifeste de l'application installable (PWA), propre à chaque lien
app.get('/c/:jeton/manifest.webmanifest', async (req, res) => {
  // Version sans « dernière visite » : le téléphone relit le manifeste tout seul
  const acces = await stockage.trouverAccesParJeton(req.params.jeton);
  if (!acces) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  const adresseDuLien = `/c/${req.params.jeton}`;
  const titre = acces.calendrier.titre;
  res.type('application/manifest+json').json({
    id: adresseDuLien,
    name: titre,
    short_name: titre.length <= 12 ? titre : 'Avent',
    description: "Calendrier de l'Avent : une surprise par jour jusqu'à Noël.",
    lang: 'fr',
    start_url: adresseDuLien,
    scope: adresseDuLien,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0c2024',
    theme_color: '#0c2024',
    icons: [
      { src: '/img/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/img/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/img/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

// ---------- Données d'un calendrier pour la page publique ----------

// toutEstOuvert : aperçu admin ou « Test date » coché
function donneesPubliques(calendrier, { apercu }) {
  const modeTest = calendrier.modeTest === true;
  const toutEstOuvert = apercu || modeTest;
  const aujourdhui = dates.dateDuJour();

  const jours = calendrier.jours.map((jour) => {
    const ouvrable = toutEstOuvert || dates.estOuvrable(calendrier.annee, jour.numero, aujourdhui);
    if (!ouvrable) {
      // On n'envoie surtout pas le contenu des cases fermées
      return { numero: jour.numero, ouvrable: false };
    }
    return {
      numero: jour.numero,
      ouvrable: true,
      texte: jour.texte,
      image: jour.image ? `/uploads/${jour.image}` : null,
    };
  });

  return {
    // Graine du mélange des cases et clé de mémoire locale : identique pour tous les liens
    graine: calendrier.id,
    titre: calendrier.titre,
    message: calendrier.message,
    annee: calendrier.annee,
    aujourdhui: dates.formatIso(aujourdhui),
    apercu,
    modeTest,
    ...dates.situation(calendrier.annee, aujourdhui),
    jours,
  };
}

app.get('/api/c/:jeton', async (req, res) => {
  const acces = await stockage.trouverParJeton(req.params.jeton);
  if (!acces) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  const donnees = donneesPubliques(acces.calendrier, { apercu: false });
  donnees.casesOuvertes = acces.casesOuvertes;
  res.json(donnees);
});

// Le destinataire vient d'ouvrir une case : on s'en souvient pour ce lien
app.post('/api/c/:jeton/ouvertures/:numero', async (req, res) => {
  const numero = Number(req.params.numero);
  const numeroValide = Number.isInteger(numero) && numero >= 1 && numero <= dates.NOMBRE_DE_JOURS;
  const acces = numeroValide ? await stockage.trouverAccesParJeton(req.params.jeton) : null;
  if (!acces) {
    return res.status(404).json({ erreur: 'Case introuvable' });
  }

  const calendrier = acces.calendrier;
  // En « Test date », rien n'est mémorisé : les portes seront bien fermées le jour venu
  if (calendrier.modeTest) {
    return res.json({ memorise: false });
  }
  // Impossible de marquer comme ouverte une case dont le jour n'est pas arrivé
  if (!dates.estOuvrable(calendrier.annee, numero, dates.dateDuJour())) {
    return res.status(403).json({ erreur: 'Cette case est encore fermée' });
  }
  await stockage.enregistrerOuverture(acces.lienId, numero);
  res.json({ memorise: true });
});

// ---------- Authentification backoffice ----------

const FORMAT_IDENTIFIANT = /^[a-z0-9._-]{3,40}$/;
const LONGUEUR_MIN_MOT_DE_PASSE = 10;

// Empreinte bidon : on fait le même calcul quand l'identifiant n'existe pas,
// pour ne pas révéler par le temps de réponse quels identifiants existent.
const empreinteLeurre = hacherMotDePasse(crypto.randomBytes(16).toString('hex'));

function attendre(millisecondes) {
  return new Promise((resolve) => setTimeout(resolve, millisecondes));
}

app.post('/admin/api/connexion', async (req, res) => {
  const corps = req.body || {};
  const identifiant = String(corps.identifiant || '').trim().toLowerCase();
  const motDePasse = String(corps.motDePasse || '');

  // Un identifiant mal formé ne peut pas exister : inutile de le suivre
  if (!FORMAT_IDENTIFIANT.test(identifiant)) {
    await attendre(800);
    return res.status(401).json({ erreur: 'Identifiant ou mot de passe incorrect' });
  }
  const minutesRestantes = limiteConnexion.minutesDeBlocageRestantes(identifiant);
  if (minutesRestantes > 0) {
    return res.status(429).json({ erreur: `Trop d'essais. Réessayez dans ${minutesRestantes} min.` });
  }

  const admin = await comptes.trouverAdminParIdentifiant(identifiant);
  const empreinte = admin ? admin.empreinteMotDePasse : await empreinteLeurre;
  const motDePasseCorrect = await verifierMotDePasse(motDePasse, empreinte);

  if (!admin || !motDePasseCorrect) {
    limiteConnexion.noterEchec(identifiant);
    // Petit délai pour décourager les essais en rafale
    await attendre(800);
    return res.status(401).json({ erreur: 'Identifiant ou mot de passe incorrect' });
  }
  limiteConnexion.noterReussite(identifiant);

  req.session.regenerate((erreur) => {
    if (erreur) {
      return res.status(500).json({ erreur: 'Session impossible' });
    }
    req.session.adminId = admin.id;
    res.json({ ok: true });
  });
});

app.post('/admin/api/deconnexion', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Recharge l'admin à chaque requête : un compte supprimé perd l'accès aussitôt.
async function adminConnecte(req) {
  if (!req.session.adminId) {
    return null;
  }
  return comptes.trouverAdminParId(req.session.adminId);
}

app.get('/admin/api/session', async (req, res) => {
  const admin = await adminConnecte(req);
  if (!admin) {
    return res.json({ connecte: false });
  }
  res.json({ connecte: true, identifiant: admin.identifiant, estSuperAdmin: admin.estSuperAdmin });
});

async function exigerAdmin(req, res, next) {
  const admin = await adminConnecte(req);
  if (!admin) {
    return res.status(401).json({ erreur: 'Non connecté' });
  }
  req.admin = admin;
  next();
}

function exigerSuperAdmin(req, res, next) {
  if (!req.admin.estSuperAdmin) {
    return res.status(403).json({ erreur: 'Réservé au super admin' });
  }
  next();
}

function erreurMotDePasse(motDePasse) {
  if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
    return `Le mot de passe doit faire au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`;
  }
  if (motDePasse.length > 200) {
    return 'Mot de passe trop long.';
  }
  return null;
}

// ---------- Mon compte ----------

app.put('/admin/api/mon-compte/mot-de-passe', exigerAdmin, async (req, res) => {
  const corps = req.body || {};
  const actuel = String(corps.actuel || '');
  const nouveau = String(corps.nouveau || '');

  const actuelCorrect = await verifierMotDePasse(actuel, req.admin.empreinteMotDePasse);
  if (!actuelCorrect) {
    await attendre(800);
    return res.status(400).json({ erreur: 'Mot de passe actuel incorrect.' });
  }
  const erreur = erreurMotDePasse(nouveau);
  if (erreur) {
    return res.status(400).json({ erreur });
  }
  await comptes.changerMotDePasse(req.admin.id, nouveau);
  res.json({ ok: true });
});

// ---------- Comptes admin (super admin uniquement) ----------

app.get('/admin/api/comptes', exigerAdmin, exigerSuperAdmin, async (req, res) => {
  const liste = await comptes.listerAdmins();
  const avecMarqueur = liste.map((compte) => ({ ...compte, estMoi: compte.id === req.admin.id }));
  res.json(avecMarqueur);
});

app.post('/admin/api/comptes', exigerAdmin, exigerSuperAdmin, async (req, res) => {
  const corps = req.body || {};
  const identifiant = String(corps.identifiant || '').trim().toLowerCase();
  const motDePasse = String(corps.motDePasse || '');
  const estSuperAdmin = corps.estSuperAdmin === true;

  if (!FORMAT_IDENTIFIANT.test(identifiant)) {
    return res.status(400).json({ erreur: "L'identifiant : 3 à 40 caractères, minuscules, chiffres, point, tiret." });
  }
  const erreur = erreurMotDePasse(motDePasse);
  if (erreur) {
    return res.status(400).json({ erreur });
  }
  if (await comptes.identifiantEstPris(identifiant)) {
    return res.status(400).json({ erreur: 'Cet identifiant existe déjà.' });
  }
  const admin = await comptes.creerAdmin({ identifiant, motDePasse, estSuperAdmin });
  res.status(201).json({ id: admin.id, identifiant: admin.identifiant, estSuperAdmin: admin.estSuperAdmin });
});

app.put('/admin/api/comptes/:id/mot-de-passe', exigerAdmin, exigerSuperAdmin, async (req, res) => {
  const motDePasse = String((req.body || {}).motDePasse || '');
  const erreur = erreurMotDePasse(motDePasse);
  if (erreur) {
    return res.status(400).json({ erreur });
  }
  const compte = await comptes.trouverAdminParId(req.params.id);
  if (!compte) {
    return res.status(404).json({ erreur: 'Compte introuvable' });
  }
  await comptes.changerMotDePasse(compte.id, motDePasse);
  res.json({ ok: true });
});

app.delete('/admin/api/comptes/:id', exigerAdmin, exigerSuperAdmin, async (req, res) => {
  if (req.params.id === req.admin.id) {
    return res.status(400).json({ erreur: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }
  if (!(await comptes.supprimerAdmin(req.params.id))) {
    return res.status(404).json({ erreur: 'Compte introuvable' });
  }
  res.json({ ok: true });
});

// ---------- Calendriers de l'admin connecté ----------

// Vérifie et nettoie les champs d'un calendrier. Renvoie { erreur } ou { valeurs }.
function validerCalendrier(corps) {
  const titre = String(corps.titre || '').trim();
  const message = String(corps.message || '').trim();
  const annee = Number(corps.annee);
  const modeTest = corps.modeTest === true;

  if (titre.length === 0 || titre.length > 80) {
    return { erreur: 'Le titre doit faire entre 1 et 80 caractères.' };
  }
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) {
    return { erreur: 'Année invalide.' };
  }
  if (message.length > 500) {
    return { erreur: "Le message d'accueil est limité à 500 caractères." };
  }
  return { valeurs: { titre, message, annee, modeTest } };
}

app.get('/admin/api/calendriers', exigerAdmin, async (req, res) => {
  res.json(await stockage.listerCalendriers(req.admin.id));
});

app.post('/admin/api/calendriers', exigerAdmin, async (req, res) => {
  const resultat = validerCalendrier(req.body || {});
  if (resultat.erreur) {
    return res.status(400).json({ erreur: resultat.erreur });
  }
  res.status(201).json(await stockage.creerCalendrier(req.admin.id, resultat.valeurs));
});

app.get('/admin/api/calendriers/:id', exigerAdmin, async (req, res) => {
  const calendrier = await stockage.trouverCalendrier(req.admin.id, req.params.id);
  if (!calendrier) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  res.json(calendrier);
});

// Aperçu : toutes les cases ouvertes, uniquement pour le propriétaire
app.get('/admin/api/calendriers/:id/apercu', exigerAdmin, async (req, res) => {
  const calendrier = await stockage.trouverCalendrier(req.admin.id, req.params.id);
  if (!calendrier) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  res.json(donneesPubliques(calendrier, { apercu: true }));
});

app.put('/admin/api/calendriers/:id', exigerAdmin, async (req, res) => {
  const resultat = validerCalendrier(req.body || {});
  if (resultat.erreur) {
    return res.status(400).json({ erreur: resultat.erreur });
  }
  const calendrier = await stockage.modifierCalendrier(req.admin.id, req.params.id, resultat.valeurs);
  if (!calendrier) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  res.json(calendrier);
});

app.delete('/admin/api/calendriers/:id', exigerAdmin, async (req, res) => {
  if (!(await stockage.supprimerCalendrier(req.admin.id, req.params.id))) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  res.json({ ok: true });
});

// ---------- Liens d'accès ----------

app.post('/admin/api/calendriers/:id/liens', exigerAdmin, async (req, res) => {
  const nom = String((req.body || {}).nom || '').trim();
  if (nom.length === 0 || nom.length > 60) {
    return res.status(400).json({ erreur: 'Le nom du lien doit faire entre 1 et 60 caractères.' });
  }
  const lien = await stockage.creerLien(req.admin.id, req.params.id, nom);
  if (!lien) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  res.status(201).json(lien);
});

app.delete('/admin/api/calendriers/:id/liens/:lienId', exigerAdmin, async (req, res) => {
  if (!(await stockage.supprimerLien(req.admin.id, req.params.id, req.params.lienId))) {
    return res.status(404).json({ erreur: 'Lien introuvable' });
  }
  res.json({ ok: true });
});

// ---------- Images des cases ----------

const EXTENSIONS_PAR_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: images.DOSSIER_IMAGES,
    filename: (req, fichier, rappel) => {
      rappel(null, crypto.randomUUID() + EXTENSIONS_PAR_TYPE[fichier.mimetype]);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, fichier, rappel) => {
    const typeAccepte = EXTENSIONS_PAR_TYPE[fichier.mimetype] !== undefined;
    rappel(null, typeAccepte);
  },
});

// exigerAdmin passe avant multer : un visiteur non connecté ne peut rien déposer sur le disque
app.put('/admin/api/calendriers/:id/jours/:numero', exigerAdmin, upload.single('image'), async (req, res) => {
  const numero = Number(req.params.numero);
  const numeroValide = Number.isInteger(numero) && numero >= 1 && numero <= dates.NOMBRE_DE_JOURS;

  const corps = req.body || {};
  const texte = String(corps.texte || '').slice(0, 2000);
  const modifications = { texte };
  if (req.file) {
    modifications.image = req.file.filename;
  } else if (corps.supprimerImage === '1') {
    modifications.image = null;
  }

  const jour = numeroValide ? await stockage.modifierJour(req.admin.id, req.params.id, numero, modifications) : null;
  if (!jour) {
    if (req.file) {
      images.supprimerFichierImage(req.file.filename);
    }
    return res.status(404).json({ erreur: 'Case introuvable' });
  }
  res.json(jour);
});

// ---------- Erreurs ----------

app.use((erreur, req, res, next) => {
  if (erreur instanceof multer.MulterError) {
    const message = erreur.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (10 Mo maximum).' : 'Envoi du fichier impossible.';
    return res.status(400).json({ erreur: message });
  }
  console.error(erreur);
  res.status(500).json({ erreur: 'Erreur interne' });
});

// ---------- Démarrage ----------

async function demarrer() {
  await bdd.initialiserSchema();

  const identifiantInitial = String(process.env.ADMIN_LOGIN || 'admin').trim().toLowerCase();
  const motDePasseInitial = process.env.ADMIN_PASSWORD;
  const premierAdmin = motDePasseInitial
    ? await comptes.creerPremierAdminSiBesoin(identifiantInitial, motDePasseInitial)
    : null;
  if (premierAdmin) {
    console.log(`Premier compte super admin créé : « ${premierAdmin.identifiant} » (mot de passe = ADMIN_PASSWORD).`);
  }
  if ((await comptes.listerAdmins()).length === 0) {
    console.error('Aucun compte admin : définissez ADMIN_PASSWORD (et ADMIN_LOGIN) dans .env pour créer le premier.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    const aujourdhui = dates.formatIso(dates.dateDuJour());
    console.log(`Calendrier de l'Avent prêt sur http://localhost:${PORT} (date du jour : ${aujourdhui})`);
    console.log(`Backoffice : http://localhost:${PORT}/admin/`);
  });
}

demarrer().catch((erreur) => {
  console.error('Démarrage impossible :', erreur.message);
  process.exit(1);
});
