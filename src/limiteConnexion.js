// Limite les essais de connexion : après trop d'échecs sur un identifiant,
// cet identifiant est bloqué quelques minutes. Suivi en mémoire, remis à zéro au redémarrage.

const NOMBRE_ECHECS_MAX = 5;
const DUREE_BLOCAGE_MS = 10 * 60 * 1000;
const NOMBRE_IDENTIFIANTS_SUIVIS_MAX = 5000;

// identifiant -> { echecs, finDuBlocage, dernierEchec }
const suivis = new Map();

function minutesDeBlocageRestantes(identifiant) {
  const suivi = suivis.get(identifiant);
  if (!suivi || suivi.finDuBlocage <= Date.now()) {
    return 0;
  }
  return Math.ceil((suivi.finDuBlocage - Date.now()) / 60000);
}

function oublierLesAnciensSuivis() {
  const maintenant = Date.now();
  for (const [identifiant, suivi] of suivis) {
    if (maintenant - suivi.dernierEchec > DUREE_BLOCAGE_MS) {
      suivis.delete(identifiant);
    }
  }
}

function noterEchec(identifiant) {
  // Évite que la mémoire grossisse sans fin si quelqu'un essaie des milliers d'identifiants
  if (suivis.size >= NOMBRE_IDENTIFIANTS_SUIVIS_MAX) {
    oublierLesAnciensSuivis();
  }

  const maintenant = Date.now();
  let suivi = suivis.get(identifiant);
  const suiviPerime = suivi && maintenant - suivi.dernierEchec > DUREE_BLOCAGE_MS;
  if (!suivi || suiviPerime) {
    suivi = { echecs: 0, finDuBlocage: 0, dernierEchec: maintenant };
    suivis.set(identifiant, suivi);
  }

  suivi.echecs++;
  suivi.dernierEchec = maintenant;
  if (suivi.echecs >= NOMBRE_ECHECS_MAX) {
    suivi.finDuBlocage = maintenant + DUREE_BLOCAGE_MS;
    suivi.echecs = 0;
  }
}

function noterReussite(identifiant) {
  suivis.delete(identifiant);
}

module.exports = {
  minutesDeBlocageRestantes,
  noterEchec,
  noterReussite,
};
