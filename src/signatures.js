// Vérifie qu'un fichier envoyé est bien ce qu'il prétend être, en lisant ses premiers octets
// (sa « signature »). Le type annoncé par le navigateur ne prouve rien : n'importe qui peut
// envoyer une page HTML en la déclarant « image/png ».

const fs = require('node:fs/promises');

const NOMBRE_OCTETS_LUS = 12;

// Compare les octets du fichier, à partir de la position donnée, avec le texte ou les octets attendus
function commencePar(octets, position, attendu) {
  const attenduEnOctets = typeof attendu === 'string' ? Buffer.from(attendu, 'latin1') : Buffer.from(attendu);
  const morceau = octets.subarray(position, position + attenduEnOctets.length);
  return morceau.equals(attenduEnOctets);
}

function estUnMp3(octets) {
  // Soit une étiquette ID3 en tête, soit directement une trame MPEG (11 bits à 1)
  const avecEtiquette = commencePar(octets, 0, 'ID3');
  const trameMpeg = octets[0] === 0xff && (octets[1] & 0xe0) === 0xe0;
  return avecEtiquette || trameMpeg;
}

// Une vérification par extension (l'extension est choisie par le serveur à partir du type annoncé)
const VERIFICATIONS = {
  '.jpg': (octets) => commencePar(octets, 0, [0xff, 0xd8, 0xff]),
  '.png': (octets) => commencePar(octets, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  '.gif': (octets) => commencePar(octets, 0, 'GIF87a') || commencePar(octets, 0, 'GIF89a'),
  '.webp': (octets) => commencePar(octets, 0, 'RIFF') && commencePar(octets, 8, 'WEBP'),
  '.mp3': estUnMp3,
  '.m4a': (octets) => commencePar(octets, 4, 'ftyp'),
  '.ogg': (octets) => commencePar(octets, 0, 'OggS'),
  '.wav': (octets) => commencePar(octets, 0, 'RIFF') && commencePar(octets, 8, 'WAVE'),
};

async function lirePremiersOctets(chemin) {
  const fichier = await fs.open(chemin, 'r');
  try {
    const octets = Buffer.alloc(NOMBRE_OCTETS_LUS);
    const { bytesRead } = await fichier.read(octets, 0, NOMBRE_OCTETS_LUS, 0);
    return octets.subarray(0, bytesRead);
  } finally {
    await fichier.close();
  }
}

async function contenuCorrespondAExtension(chemin, extension) {
  const verifier = VERIFICATIONS[extension];
  if (!verifier) {
    return false;
  }
  const octets = await lirePremiersOctets(chemin);
  return verifier(octets);
}

module.exports = {
  contenuCorrespondAExtension,
};
