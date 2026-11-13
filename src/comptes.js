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

// Supprime un admin, ses calendriers (par cascade) et les images de ses calendriers.
async function supprimerAdmin(id) {
  if (!estUnUuid(id)) {
    return false;
  }
  const imagesASupprimer = await enTransaction(async (client) => {
    const images = await client.query(
      `SELECT j.image FROM jours j
       JOIN calendriers c ON c.id = j.calendrier_id
       WHERE c.admin_id = $1 AND j.image IS NOT NULL`,
      [id]
    );
    const suppression = await client.query('DELETE FROM admins WHERE id = $1', [id]);
    if (suppression.rowCount === 0) {
      return null;
    }
    return images.rows.map((ligne) => ligne.image);
  });

  if (imagesASupprimer === null) {
    return false;
  }
  imagesASupprimer.forEach(supprimerFichierImage);
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
  supprimerAdmin,
  creerPremierAdminSiBesoin,
};
