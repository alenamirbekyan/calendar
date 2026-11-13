// Hachage des mots de passe avec scrypt (inclus dans Node, pas de dépendance).
// Format stocké : scrypt$<sel en hexa>$<empreinte en hexa>

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const LONGUEUR_EMPREINTE = 64;

async function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16);
  const empreinte = await scrypt(String(motDePasse), sel, LONGUEUR_EMPREINTE);
  return `scrypt$${sel.toString('hex')}$${empreinte.toString('hex')}`;
}

async function verifierMotDePasse(motDePasse, empreinteStockee) {
  const morceaux = String(empreinteStockee).split('$');
  if (morceaux.length !== 3 || morceaux[0] !== 'scrypt') {
    return false;
  }
  const sel = Buffer.from(morceaux[1], 'hex');
  const empreinteAttendue = Buffer.from(morceaux[2], 'hex');
  const empreinteSaisie = await scrypt(String(motDePasse), sel, empreinteAttendue.length);
  return crypto.timingSafeEqual(empreinteSaisie, empreinteAttendue);
}

module.exports = {
  hacherMotDePasse,
  verifierMotDePasse,
};
