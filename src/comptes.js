// Comptes admin du backoffice.

const crypto = require('node:crypto');
const { pool, enTransaction, estUnUuid } = require('./bdd');
const { hacherMotDePasse } = require('./motsDePasse');
const { supprimerFichierImage } = require('./images');

function versAdmin(ligne) {
  return {
    id: ligne.id,
    identifiant: ligne.identifiant,
    empreinteMotDePasse: ligne.empreinte_mdp,
    estSuperAdmin: ligne.est_super_admin,
    creeLe: ligne.cree_le,
  };
}

async function trouverAdminParId(id) {
  if (!estUnUuid(id)) {
    return null;
  }
  const resultat = await pool.query('SELECT * FROM admins WHERE id = $1', [id]);
  return resultat.rows.length > 0 ? versAdmin(resultat.rows[0]) : null;
}

async function trouverAdminParIdentifiant(identifiant) {
  const resultat = await pool.query('SELECT * FROM admins WHERE identifiant = $1', [identifiant]);
  return resultat.rows.length > 0 ? versAdmin(resultat.rows[0]) : null;
}

async function listerAdmins() {
  const resultat = await pool.query(`
    SELECT a.id, a.identifiant, a.est_super_admin, a.cree_le, COUNT(c.id)::int AS nombre_calendriers
    FROM admins a
    LEFT JOIN calendriers c ON c.admin_id = a.id
    GROUP BY a.id
    ORDER BY a.identifiant
  `);
  return resultat.rows.map((ligne) => ({
    id: ligne.id,
    identifiant: ligne.identifiant,
    estSuperAdmin: ligne.est_super_admin,
    creeLe: ligne.cree_le,
    nombreCalendriers: ligne.nombre_calendriers,
  }));
}

async function identifiantEstPris(identifiant) {
  const resultat = await pool.query('SELECT 1 FROM admins WHERE identifiant = $1', [identifiant]);
  return resultat.rows.length > 0;
}

async function creerAdmin({ identifiant, motDePasse, estSuperAdmin }) {
  const id = crypto.randomUUID();
  const empreinte = await hacherMotDePasse(motDePasse);
  await pool.query(
    'INSERT INTO admins (id, identifiant, empreinte_mdp, est_super_admin) VALUES ($1, $2, $3, $4)',
    [id, identifiant, empreinte, estSuperAdmin]
  );
  return trouverAdminParId(id);
}

async function changerMotDePasse(id, nouveauMotDePasse) {
  const empreinte = await hacherMotDePasse(nouveauMotDePasse);
  const resultat = await pool.query('UPDATE admins SET empreinte_mdp = $1 WHERE id = $2', [empreinte, id]);
  return resultat.rowCount > 0;
}

// Déconnecte toutes les sessions ouvertes d'un admin (après un changement de mot de passe),
// sauf éventuellement celle en cours. Les sessions sont dans la table « sessions »
// (connect-pg-simple), l'id de l'admin est dans la colonne JSON « sess ».
async function fermerSessions(adminId, sessionAGarder) {
  if (sessionAGarder) {
    await pool.query("DELETE FROM sessions WHERE sess->>'adminId' = $1 AND sid <> $2", [adminId, sessionAGarder]);
  } else {
    await pool.query("DELETE FROM sessions WHERE sess->>'adminId' = $1", [adminId]);
  }
}

// Supprime un admin, ses calendriers (par cascade) et les fichiers (images, musiques) de ses calendriers.
async function supprimerAdmin(id) {
  if (!estUnUuid(id)) {
    return false;
  }
  const fichiersASupprimer = await enTransaction(async (client) => {
    const fichiers = await client.query(
      `SELECT j.image, j.musique FROM jours j
       JOIN calendriers c ON c.id = j.calendrier_id
       WHERE c.admin_id = $1 AND (j.image IS NOT NULL OR j.musique IS NOT NULL)`,
      [id]
    );
    const suppression = await client.query('DELETE FROM admins WHERE id = $1', [id]);
    if (suppression.rowCount === 0) {
      return null;
    }
    const noms = [];
    for (const ligne of fichiers.rows) {
      noms.push(ligne.image, ligne.musique);
    }
    return noms;
  });

  if (fichiersASupprimer === null) {
    return false;
  }
  // supprimerFichierImage ignore les valeurs nulles
  fichiersASupprimer.forEach(supprimerFichierImage);
  return true;
}

// Au tout premier démarrage, crée le super admin à partir du .env.
async function creerPremierAdminSiBesoin(identifiant, motDePasse) {
  const resultat = await pool.query('SELECT COUNT(*)::int AS nombre FROM admins');
  if (resultat.rows[0].nombre > 0) {
    return null;
  }
  return creerAdmin({ identifiant, motDePasse, estSuperAdmin: true });
}

module.exports = {
  trouverAdminParId,
  trouverAdminParIdentifiant,
  listerAdmins,
  identifiantEstPris,
  creerAdmin,
  changerMotDePasse,
  fermerSessions,
  supprimerAdmin,
  creerPremierAdminSiBesoin,
};
