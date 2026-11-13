// Fichiers images des cases, stockés sous un nom aléatoire dans data/uploads.

const fs = require('node:fs');
const path = require('node:path');

const DOSSIER_IMAGES = path.join(__dirname, '..', 'data', 'uploads');

fs.mkdirSync(DOSSIER_IMAGES, { recursive: true });

function supprimerFichierImage(nomFichier) {
  if (!nomFichier) {
    return;
  }
  // path.basename empêche de sortir du dossier des images
  const chemin = path.join(DOSSIER_IMAGES, path.basename(nomFichier));
  fs.rm(chemin, { force: true }, () => {});
}

module.exports = {
  DOSSIER_IMAGES,
  supprimerFichierImage,
};
