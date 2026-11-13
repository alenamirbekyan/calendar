// Stockage très simple dans un fichier JSON (data/calendriers.json).
// Suffisant pour quelques calendriers, sans base de données à installer.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { NOMBRE_DE_JOURS } = require('./dates');

const DOSSIER_DATA = path.join(__dirname, '..', 'data');
const DOSSIER_IMAGES = path.join(DOSSIER_DATA, 'uploads');
const FICHIER = path.join(DOSSIER_DATA, 'calendriers.json');

fs.mkdirSync(DOSSIER_IMAGES, { recursive: true });

let calendriers = chargerDepuisLeDisque();

function chargerDepuisLeDisque() {
  if (!fs.existsSync(FICHIER)) {
    return [];
  }
  const contenu = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
  return contenu.calendriers || [];
}

// Écriture dans un fichier temporaire puis renommage : évite un fichier à moitié écrit.
function sauvegarder() {
  const fichierTemporaire = FICHIER + '.tmp';
  fs.writeFileSync(fichierTemporaire, JSON.stringify({ calendriers }, null, 2));
  fs.renameSync(fichierTemporaire, FICHIER);
}

function joursVides() {
  const jours = [];
  for (let numero = 1; numero <= NOMBRE_DE_JOURS; numero++) {
    jours.push({ numero, texte: '', image: null });
  }
  return jours;
}

function listerCalendriers() {
  return calendriers;
}

function trouverParId(id) {
  return calendriers.find((calendrier) => calendrier.id === id) || null;
}

function trouverParSlug(slug) {
  return calendriers.find((calendrier) => calendrier.slug === slug) || null;
}

function slugEstPris(slug, idAExclure) {
  return calendriers.some((calendrier) => calendrier.slug === slug && calendrier.id !== idAExclure);
}

function creerCalendrier({ titre, slug, annee, message, modeTest }) {
  const calendrier = {
    id: crypto.randomUUID(),
    slug,
    titre,
    message,
    annee,
    modeTest,
    creeLe: new Date().toISOString(),
    jours: joursVides(),
  };
  calendriers.push(calendrier);
  sauvegarder();
  return calendrier;
}

function modifierCalendrier(id, modifications) {
  const calendrier = trouverParId(id);
  if (!calendrier) {
    return null;
  }
  Object.assign(calendrier, modifications);
  sauvegarder();
  return calendrier;
}

function modifierJour(id, numero, { texte, image }) {
  const calendrier = trouverParId(id);
  if (!calendrier) {
    return null;
  }
  const jour = calendrier.jours.find((j) => j.numero === numero);
  if (texte !== undefined) {
    jour.texte = texte;
  }
  if (image !== undefined) {
    supprimerFichierImage(jour.image);
    jour.image = image;
  }
  sauvegarder();
  return jour;
}

function supprimerCalendrier(id) {
  const calendrier = trouverParId(id);
  if (!calendrier) {
    return false;
  }
  for (const jour of calendrier.jours) {
    supprimerFichierImage(jour.image);
  }
  calendriers = calendriers.filter((c) => c.id !== id);
  sauvegarder();
  return true;
}

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
  listerCalendriers,
  trouverParId,
  trouverParSlug,
  slugEstPris,
  creerCalendrier,
  modifierCalendrier,
  modifierJour,
  supprimerCalendrier,
  supprimerFichierImage,
};
