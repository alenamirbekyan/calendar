// Gestion des dates : tout repose sur la date système du serveur.

const NOMBRE_DE_JOURS = 24;

// Date du jour à minuit (heure locale du serveur).
// DATE_SIMULEE (AAAA-MM-JJ) permet de tester sans attendre décembre.
function dateDuJour() {
  const dateSimulee = process.env.DATE_SIMULEE;
  if (dateSimulee && /^\d{4}-\d{2}-\d{2}$/.test(dateSimulee)) {
    const [annee, mois, jour] = dateSimulee.split('-').map(Number);
    return new Date(annee, mois - 1, jour);
  }
  const maintenant = new Date();
  return new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
}

function dateDeLaCase(annee, numero) {
  return new Date(annee, 11, numero);
}

function estOuvrable(annee, numero, aujourdhui) {
  return aujourdhui >= dateDeLaCase(annee, numero);
}

function nombreDeJoursEntre(debut, fin) {
  const unJour = 24 * 60 * 60 * 1000;
  return Math.round((fin - debut) / unJour);
}

// Résume où l'on en est par rapport au calendrier d'une année donnée.
function situation(annee, aujourdhui) {
  const premierDecembre = dateDeLaCase(annee, 1);
  const dernierJour = dateDeLaCase(annee, NOMBRE_DE_JOURS);

  if (aujourdhui < premierDecembre) {
    return { etat: 'avant', joursAvantOuverture: nombreDeJoursEntre(aujourdhui, premierDecembre), jourCourant: null };
  }
  if (aujourdhui > dernierJour) {
    return { etat: 'apres', joursAvantOuverture: 0, jourCourant: null };
  }
  return { etat: 'pendant', joursAvantOuverture: 0, jourCourant: aujourdhui.getDate() };
}

function formatIso(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

module.exports = {
  NOMBRE_DE_JOURS,
  dateDuJour,
  estOuvrable,
  nombreDeJoursEntre,
  dateDeLaCase,
  situation,
  formatIso,
};
