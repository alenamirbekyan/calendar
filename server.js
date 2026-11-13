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

const stockage = require('./src/stockage');
const dates = require('./src/dates');

const PORT = Number(process.env.PORT) || 3000;
const MOT_DE_PASSE_ADMIN = process.env.ADMIN_PASSWORD;
const DOSSIER_PUBLIC = path.join(__dirname, 'public');

if (!MOT_DE_PASSE_ADMIN) {
  console.error('ADMIN_PASSWORD manquant : copiez .env.example en .env et définissez un mot de passe.');
  process.exit(1);
}

let secretDeSession = process.env.SESSION_SECRET;
if (!secretDeSession) {
  secretDeSession = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET absent : secret temporaire généré (les sessions sautent au redémarrage).');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(
  session({
    secret: secretDeSession,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

// ---------- Fichiers statiques ----------

app.use(express.static(DOSSIER_PUBLIC));
// Les noms de fichiers sont des UUID : impossible de deviner l'image d'une case encore fermée.
app.use('/uploads', express.static(stockage.DOSSIER_IMAGES, { maxAge: '7d' }));

app.get('/c/:slug', (req, res) => {
  res.sendFile(path.join(DOSSIER_PUBLIC, 'calendrier.html'));
});

// ---------- API publique ----------

app.get('/api/calendriers/:slug', (req, res) => {
  const calendrier = stockage.trouverParSlug(req.params.slug);
  if (!calendrier) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }

  // Un admin connecté peut prévisualiser toutes les cases avec ?apercu=1
  const apercu = req.query.apercu === '1' && req.session.admin === true;
  // « Test date » coché dans le backoffice : les verrous de date sautent pour tout le monde
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

  res.json({
    titre: calendrier.titre,
    message: calendrier.message,
    annee: calendrier.annee,
    aujourdhui: dates.formatIso(aujourdhui),
    apercu,
    modeTest,
    ...dates.situation(calendrier.annee, aujourdhui),
    jours,
  });
});

// ---------- Authentification backoffice ----------

function motDePasseCorrect(saisie) {
  // Comparaison à temps constant sur des empreintes de même longueur
  const empreinteSaisie = crypto.createHash('sha256').update(String(saisie)).digest();
  const empreinteAttendue = crypto.createHash('sha256').update(MOT_DE_PASSE_ADMIN).digest();
  return crypto.timingSafeEqual(empreinteSaisie, empreinteAttendue);
}

app.post('/admin/api/connexion', async (req, res) => {
  const motDePasse = req.body ? req.body.motDePasse : '';
  if (!motDePasseCorrect(motDePasse || '')) {
    // Petit délai pour décourager les essais en rafale
    await new Promise((resolve) => setTimeout(resolve, 800));
    return res.status(401).json({ erreur: 'Mot de passe incorrect' });
  }
  req.session.regenerate((erreur) => {
    if (erreur) {
      return res.status(500).json({ erreur: 'Session impossible' });
    }
    req.session.admin = true;
    res.json({ ok: true });
  });
});

app.post('/admin/api/deconnexion', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/admin/api/session', (req, res) => {
  res.json({ connecte: req.session.admin === true });
});

function exigerAdmin(req, res, next) {
  if (req.session.admin !== true) {
    return res.status(401).json({ erreur: 'Non connecté' });
  }
  next();
}

// ---------- API backoffice ----------

const FORMAT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Vérifie et nettoie les champs d'un calendrier. Renvoie { erreur } ou { valeurs }.
function validerCalendrier(corps, idEnCours) {
  const titre = String(corps.titre || '').trim();
  const slug = String(corps.slug || '').trim().toLowerCase();
  const message = String(corps.message || '').trim();
  const annee = Number(corps.annee);
  const modeTest = corps.modeTest === true;

  if (titre.length === 0 || titre.length > 80) {
    return { erreur: 'Le titre doit faire entre 1 et 80 caractères.' };
  }
  if (slug.length < 2 || slug.length > 60 || !FORMAT_SLUG.test(slug)) {
    return { erreur: "L'adresse ne doit contenir que des minuscules, chiffres et tirets (2 à 60 caractères)." };
  }
  if (stockage.slugEstPris(slug, idEnCours)) {
    return { erreur: 'Cette adresse est déjà utilisée par un autre calendrier.' };
  }
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) {
    return { erreur: 'Année invalide.' };
  }
  if (message.length > 500) {
    return { erreur: "Le message d'accueil est limité à 500 caractères." };
  }
  return { valeurs: { titre, slug, message, annee, modeTest } };
}

function resumeCalendrier(calendrier) {
  const joursRemplis = calendrier.jours.filter((jour) => jour.texte || jour.image).length;
  return {
    id: calendrier.id,
    slug: calendrier.slug,
    titre: calendrier.titre,
    annee: calendrier.annee,
    modeTest: calendrier.modeTest === true,
    joursRemplis,
  };
}

app.get('/admin/api/calendriers', exigerAdmin, (req, res) => {
  res.json(stockage.listerCalendriers().map(resumeCalendrier));
});

app.post('/admin/api/calendriers', exigerAdmin, (req, res) => {
  const resultat = validerCalendrier(req.body || {}, null);
  if (resultat.erreur) {
    return res.status(400).json({ erreur: resultat.erreur });
  }
  res.status(201).json(stockage.creerCalendrier(resultat.valeurs));
});

app.get('/admin/api/calendriers/:id', exigerAdmin, (req, res) => {
  const calendrier = stockage.trouverParId(req.params.id);
  if (!calendrier) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  res.json(calendrier);
});

app.put('/admin/api/calendriers/:id', exigerAdmin, (req, res) => {
  if (!stockage.trouverParId(req.params.id)) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  const resultat = validerCalendrier(req.body || {}, req.params.id);
  if (resultat.erreur) {
    return res.status(400).json({ erreur: resultat.erreur });
  }
  res.json(stockage.modifierCalendrier(req.params.id, resultat.valeurs));
});

app.delete('/admin/api/calendriers/:id', exigerAdmin, (req, res) => {
  if (!stockage.supprimerCalendrier(req.params.id)) {
    return res.status(404).json({ erreur: 'Calendrier introuvable' });
  }
  res.json({ ok: true });
});

// Upload d'images : stockées sous un nom aléatoire dans data/uploads
const EXTENSIONS_PAR_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: stockage.DOSSIER_IMAGES,
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

app.put('/admin/api/calendriers/:id/jours/:numero', exigerAdmin, upload.single('image'), (req, res) => {
  const numero = Number(req.params.numero);
  const calendrier = stockage.trouverParId(req.params.id);
  const numeroValide = Number.isInteger(numero) && numero >= 1 && numero <= dates.NOMBRE_DE_JOURS;

  if (!calendrier || !numeroValide) {
    if (req.file) {
      stockage.supprimerFichierImage(req.file.filename);
    }
    return res.status(404).json({ erreur: 'Case introuvable' });
  }

  const texte = String(req.body.texte || '').slice(0, 2000);
  const modifications = { texte };

  if (req.file) {
    modifications.image = req.file.filename;
  } else if (req.body.supprimerImage === '1') {
    modifications.image = null;
  }

  res.json(stockage.modifierJour(calendrier.id, numero, modifications));
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

app.listen(PORT, () => {
  const aujourdhui = dates.formatIso(dates.dateDuJour());
  console.log(`Calendrier de l'Avent prêt sur http://localhost:${PORT} (date du jour : ${aujourdhui})`);
  console.log(`Backoffice : http://localhost:${PORT}/admin/`);
});
