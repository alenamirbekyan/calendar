// Calendriers, cases et liens d'accès, stockés dans PostgreSQL.
// Toutes les fonctions du backoffice prennent l'id de l'admin connecté :
// un admin ne peut ni lire ni modifier le calendrier d'un autre.

const crypto = require('node:crypto');
const { pool, enTransaction, estUnUuid } = require('./bdd');
const { NOMBRE_DE_JOURS } = require('./dates');
const { supprimerFichierImage } = require('./images');

// 24 octets aléatoires = 32 caractères dans l'URL, impossible à deviner.
const FORMAT_JETON = /^[A-Za-z0-9_-]{32}$/;

function genererJeton() {
  return crypto.randomBytes(24).toString('base64url');
}

// ---------- Conversion des lignes SQL en objets ----------

function versCalendrier(ligne) {
  return {
    id: ligne.id,
    titre: ligne.titre,
    message: ligne.message,
    annee: ligne.annee,
    modeTest: ligne.mode_test,
    creeLe: ligne.cree_le,
  };
}

function versJour(ligne) {
  return {
    numero: ligne.numero,
    texte: ligne.texte,
    image: ligne.image,
  };
}

function versLien(ligne) {
  return {
    id: ligne.id,
    nom: ligne.nom,
    jeton: ligne.jeton,
    creeLe: ligne.cree_le,
    derniereVisite: ligne.derniere_visite,
    casesOuvertes: ligne.cases_ouvertes || 0,
  };
}

async function lireJours(calendrierId) {
  const resultat = await pool.query(
    'SELECT numero, texte, image FROM jours WHERE calendrier_id = $1 ORDER BY numero',
    [calendrierId]
  );
  return resultat.rows.map(versJour);
}

async function lireLiens(calendrierId) {
  const resultat = await pool.query(
    `SELECT l.*, (SELECT COUNT(*)::int FROM ouvertures o WHERE o.lien_id = l.id) AS cases_ouvertes
     FROM liens l
     WHERE l.calendrier_id = $1
     ORDER BY l.cree_le`,
    [calendrierId]
  );
  return resultat.rows.map(versLien);
}

// ---------- Backoffice : calendriers ----------

async function listerCalendriers(adminId) {
  const resultat = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM jours j
         WHERE j.calendrier_id = c.id AND (j.texte <> '' OR j.image IS NOT NULL)) AS jours_remplis,
       (SELECT COUNT(*)::int FROM liens l WHERE l.calendrier_id = c.id) AS nombre_liens
     FROM calendriers c
     WHERE c.admin_id = $1
     ORDER BY c.cree_le DESC`,
    [adminId]
  );
  return resultat.rows.map((ligne) => ({
    ...versCalendrier(ligne),
    joursRemplis: ligne.jours_remplis,
    nombreLiens: ligne.nombre_liens,
  }));
}

// Renvoie null si le calendrier n'existe pas OU appartient à un autre admin.
async function trouverCalendrierSansDetails(adminId, id) {
  if (!estUnUuid(id)) {
    return null;
  }
  const resultat = await pool.query('SELECT * FROM calendriers WHERE id = $1 AND admin_id = $2', [id, adminId]);
  return resultat.rows.length > 0 ? versCalendrier(resultat.rows[0]) : null;
}

async function trouverCalendrier(adminId, id) {
  const calendrier = await trouverCalendrierSansDetails(adminId, id);
  if (!calendrier) {
    return null;
  }
  calendrier.jours = await lireJours(id);
  calendrier.liens = await lireLiens(id);
  return calendrier;
}

async function creerCalendrier(adminId, { titre, message, annee, modeTest }) {
  const id = crypto.randomUUID();
  await enTransaction(async (client) => {
    await client.query(
      'INSERT INTO calendriers (id, admin_id, titre, message, annee, mode_test) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, adminId, titre, message, annee, modeTest]
    );
    // Les 24 cases vides en une seule requête
    await client.query(
      'INSERT INTO jours (calendrier_id, numero) SELECT $1, numero FROM generate_series(1, $2::int) AS numero',
      [id, NOMBRE_DE_JOURS]
    );
  });
  return trouverCalendrier(adminId, id);
}

async function modifierCalendrier(adminId, id, { titre, message, annee, modeTest }) {
  const avant = await trouverCalendrierSansDetails(adminId, id);
  if (!avant) {
    return null;
  }
  await enTransaction(async (client) => {
    await client.query(
      `UPDATE calendriers SET titre = $1, message = $2, annee = $3, mode_test = $4
       WHERE id = $5 AND admin_id = $6`,
      [titre, message, annee, modeTest, id, adminId]
    );
    // Nouvelle année : toutes les portes se referment
    if (avant.annee !== annee) {
      await client.query(
        'DELETE FROM ouvertures o USING liens l WHERE o.lien_id = l.id AND l.calendrier_id = $1',
        [id]
      );
    }
  });
  return trouverCalendrier(adminId, id);
}

async function supprimerCalendrier(adminId, id) {
  const calendrier = await trouverCalendrierSansDetails(adminId, id);
  if (!calendrier) {
    return false;
  }
  const jours = await lireJours(id);
  // Les cases et les liens partent avec (ON DELETE CASCADE)
  await pool.query('DELETE FROM calendriers WHERE id = $1 AND admin_id = $2', [id, adminId]);
  for (const jour of jours) {
    supprimerFichierImage(jour.image);
  }
  return true;
}

// image : undefined = inchangée, null = retirée, texte = nouveau fichier
async function modifierJour(adminId, calendrierId, numero, { texte, image }) {
  const calendrier = await trouverCalendrierSansDetails(adminId, calendrierId);
  if (!calendrier) {
    return null;
  }
  const avant = await pool.query('SELECT image FROM jours WHERE calendrier_id = $1 AND numero = $2', [
    calendrierId,
    numero,
  ]);
  if (avant.rows.length === 0) {
    return null;
  }
  const ancienneImage = avant.rows[0].image;

  let resultat;
  if (image === undefined) {
    resultat = await pool.query(
      'UPDATE jours SET texte = $1 WHERE calendrier_id = $2 AND numero = $3 RETURNING numero, texte, image',
      [texte, calendrierId, numero]
    );
  } else {
    resultat = await pool.query(
      'UPDATE jours SET texte = $1, image = $2 WHERE calendrier_id = $3 AND numero = $4 RETURNING numero, texte, image',
      [texte, image, calendrierId, numero]
    );
    supprimerFichierImage(ancienneImage);
  }
  return versJour(resultat.rows[0]);
}

// ---------- Backoffice : liens d'accès ----------

async function creerLien(adminId, calendrierId, nom) {
  const calendrier = await trouverCalendrierSansDetails(adminId, calendrierId);
  if (!calendrier) {
    return null;
  }
  const resultat = await pool.query(
    'INSERT INTO liens (id, calendrier_id, nom, jeton) VALUES ($1, $2, $3, $4) RETURNING *',
    [crypto.randomUUID(), calendrierId, nom, genererJeton()]
  );
  return versLien(resultat.rows[0]);
}

async function supprimerLien(adminId, calendrierId, lienId) {
  if (!estUnUuid(calendrierId) || !estUnUuid(lienId)) {
    return false;
  }
  // La jointure garantit que le lien appartient bien à un calendrier de cet admin
  const resultat = await pool.query(
    `DELETE FROM liens l
     USING calendriers c
     WHERE l.id = $1 AND l.calendrier_id = $2 AND c.id = l.calendrier_id AND c.admin_id = $3`,
    [lienId, calendrierId, adminId]
  );
  return resultat.rowCount > 0;
}

// ---------- Page publique ----------

function jetonValide(jeton) {
  return typeof jeton === 'string' && FORMAT_JETON.test(jeton);
}

async function lireCalendrierDuLien(lienId, calendrierId) {
  const resultat = await pool.query('SELECT * FROM calendriers WHERE id = $1', [calendrierId]);
  return { lienId, calendrier: versCalendrier(resultat.rows[0]) };
}

// Ouverture de la page : trouve le calendrier du lien, ses cases, les cases
// déjà ouvertes par ce destinataire, et note la date de visite.
async function trouverParJeton(jeton) {
  if (!jetonValide(jeton)) {
    return null;
  }
  const lien = await pool.query(
    'UPDATE liens SET derniere_visite = now() WHERE jeton = $1 RETURNING id, calendrier_id',
    [jeton]
  );
  if (lien.rows.length === 0) {
    return null;
  }
  const acces = await lireCalendrierDuLien(lien.rows[0].id, lien.rows[0].calendrier_id);
  acces.calendrier.jours = await lireJours(acces.calendrier.id);

  const ouvertures = await pool.query('SELECT numero FROM ouvertures WHERE lien_id = $1 ORDER BY numero', [
    acces.lienId,
  ]);
  acces.casesOuvertes = ouvertures.rows.map((ligne) => ligne.numero);
  return acces;
}

// Version légère, sans les cases, pour enregistrer une ouverture.
async function trouverAccesParJeton(jeton) {
  if (!jetonValide(jeton)) {
    return null;
  }
  const lien = await pool.query('SELECT id, calendrier_id FROM liens WHERE jeton = $1', [jeton]);
  if (lien.rows.length === 0) {
    return null;
  }
  return lireCalendrierDuLien(lien.rows[0].id, lien.rows[0].calendrier_id);
}

async function enregistrerOuverture(lienId, numero) {
  await pool.query('INSERT INTO ouvertures (lien_id, numero) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    lienId,
    numero,
  ]);
}

module.exports = {
  listerCalendriers,
  trouverCalendrier,
  creerCalendrier,
  modifierCalendrier,
  supprimerCalendrier,
  modifierJour,
  creerLien,
  supprimerLien,
  trouverParJeton,
  trouverAccesParJeton,
  enregistrerOuverture,
};
