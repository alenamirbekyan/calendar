// Connexion à PostgreSQL (adresse dans DATABASE_URL).

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL manquant : voir .env.example.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (erreur) => {
  console.error('Erreur PostgreSQL inattendue :', erreur.message);
});

async function initialiserSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

// Exécute plusieurs requêtes d'un bloc : tout passe, ou rien.
async function enTransaction(action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultat = await action(client);
    await client.query('COMMIT');
    return resultat;
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  } finally {
    client.release();
  }
}

// Postgres refuse un uuid mal formé avec une erreur : on filtre avant.
const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function estUnUuid(valeur) {
  return typeof valeur === 'string' && FORMAT_UUID.test(valeur);
}

module.exports = {
  pool,
  initialiserSchema,
  enTransaction,
  estUnUuid,
};
