// Backoffice : gestion des calendriers et de leurs 24 cases.
'use strict';

(function () {
  const TAILLE_MAX_IMAGE = 1600; // en pixels, côté le plus long
  const PREFIXE_ADRESSE = `${window.location.host}/c/`;

  const vues = {
    connexion: document.getElementById('vue-connexion'),
    liste: document.getElementById('vue-liste'),
    edition: document.getElementById('vue-edition'),
  };

  const boutonDeconnexion = document.getElementById('bouton-deconnexion');
  const dialogueCreation = document.getElementById('dialogue-creation');
  const formulaireCreation = document.getElementById('formulaire-creation');
  const formulaireReglages = document.getElementById('formulaire-reglages');
  const dialogueJour = document.getElementById('dialogue-jour');
  const formulaireJour = document.getElementById('formulaire-jour');

  let calendrierEnCours = null;

  // ---------- Outils ----------

  class ErreurNonConnecte extends Error {}

  async function appelerApi(methode, adresse, corps) {
    const options = { method: methode, headers: {} };
    if (corps instanceof FormData) {
      options.body = corps;
    } else if (corps !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(corps);
    }

    const reponse = await fetch(adresse, options);
    const donnees = await reponse.json().catch(() => ({}));

    if (reponse.status === 401 && !adresse.endsWith('/connexion')) {
      afficherVue('connexion');
      throw new ErreurNonConnecte('Session expirée');
    }
    if (!reponse.ok) {
      throw new Error(donnees.erreur || 'Une erreur est survenue.');
    }
    return donnees;
  }

  function afficherVue(nom) {
    for (const [cle, element] of Object.entries(vues)) {
      element.hidden = cle !== nom;
    }
    boutonDeconnexion.hidden = nom === 'connexion';
    window.scrollTo(0, 0);
  }

  function afficherErreur(formulaire, message) {
    formulaire.querySelector('[data-erreur]').textContent = message || '';
  }

  let minuterieNotification = null;
  function notifier(message) {
    const element = document.getElementById('notification');
    element.textContent = message;
    element.classList.add('est-visible');
    clearTimeout(minuterieNotification);
    minuterieNotification = setTimeout(() => element.classList.remove('est-visible'), 2500);
  }

  function slugifier(texte) {
    return texte
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // retire les accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  function suffixeAleatoire() {
    return Math.random().toString(36).slice(2, 6);
  }

  function adressePublique(slug) {
    return `${window.location.origin}/c/${slug}`;
  }

  // Bloque les boutons d'un formulaire pendant un envoi
  async function pendantEnvoi(formulaire, action) {
    const boutons = formulaire.querySelectorAll('button');
    boutons.forEach((bouton) => (bouton.disabled = true));
    try {
      await action();
    } finally {
      boutons.forEach((bouton) => (bouton.disabled = false));
    }
  }

  // Les champs du calendrier sont partagés entre création et réglages
  function insererChampsCalendrier() {
    const modele = document.getElementById('modele-champs-calendrier');
    for (const conteneur of document.querySelectorAll('[data-champs-calendrier]')) {
      conteneur.appendChild(modele.content.cloneNode(true));
      conteneur.querySelector('[data-prefixe-adresse]').textContent = PREFIXE_ADRESSE;
    }
  }

  // Insertion immédiate : les écouteurs ci-dessous ont besoin de ces champs
  insererChampsCalendrier();

  function lireChampsCalendrier(formulaire) {
    return {
      titre: formulaire.elements.titre.value,
      slug: formulaire.elements.slug.value,
      annee: Number(formulaire.elements.annee.value),
      message: formulaire.elements.message.value,
      modeTest: formulaire.elements.modeTest.checked,
    };
  }

  // ---------- Connexion ----------

  document.getElementById('formulaire-connexion').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.target;
    afficherErreur(formulaire, '');
    await pendantEnvoi(formulaire, async () => {
      try {
        await appelerApi('POST', '/admin/api/connexion', { motDePasse: formulaire.elements.motDePasse.value });
        formulaire.reset();
        naviguer();
      } catch (erreur) {
        afficherErreur(formulaire, erreur.message);
      }
    });
  });

  boutonDeconnexion.addEventListener('click', async () => {
    await appelerApi('POST', '/admin/api/deconnexion');
    afficherVue('connexion');
  });

  // ---------- Liste ----------

  async function afficherListe() {
    const calendriers = await appelerApi('GET', '/admin/api/calendriers');
    const liste = document.getElementById('liste-calendriers');
    liste.replaceChildren();
    document.getElementById('liste-vide').hidden = calendriers.length > 0;

    for (const calendrier of calendriers) {
      const fiche = document.createElement('li');
      fiche.className = 'fiche';

      const titre = document.createElement('h2');
      titre.textContent = calendrier.titre;
      if (calendrier.modeTest) {
        const badge = document.createElement('span');
        badge.className = 'badge-test';
        badge.textContent = 'test date';
        titre.append(' ', badge);
      }

      const adresse = document.createElement('span');
      adresse.className = 'fiche-adresse';
      adresse.textContent = `${calendrier.annee} · /c/${calendrier.slug}`;

      const progression = document.createElement('div');
      progression.className = 'progression';
      progression.title = `${calendrier.joursRemplis} cases remplies sur 24`;
      const barre = document.createElement('span');
      barre.style.width = `${(calendrier.joursRemplis / 24) * 100}%`;
      progression.appendChild(barre);

      const compteur = document.createElement('small');
      compteur.className = 'fiche-adresse';
      compteur.textContent = `${calendrier.joursRemplis} / 24 cases remplies`;

      const actions = document.createElement('div');
      actions.className = 'fiche-actions';
      const lienModifier = document.createElement('a');
      lienModifier.className = 'bouton bouton--principal';
      lienModifier.href = `#/c/${calendrier.id}`;
      lienModifier.textContent = 'Modifier';
      const lienVoir = document.createElement('a');
      lienVoir.className = 'bouton';
      lienVoir.href = `/c/${calendrier.slug}`;
      lienVoir.target = '_blank';
      lienVoir.rel = 'noopener';
      lienVoir.textContent = 'Voir';
      actions.append(lienModifier, lienVoir);

      fiche.append(titre, adresse, progression, compteur, actions);
      liste.appendChild(fiche);
    }
  }

  // ---------- Création ----------

  let slugModifieALaMain = false;
  let suffixeCreation = '';

  document.getElementById('bouton-nouveau').addEventListener('click', () => {
    formulaireCreation.reset();
    afficherErreur(formulaireCreation, '');
    slugModifieALaMain = false;
    suffixeCreation = suffixeAleatoire();
    formulaireCreation.elements.annee.value = new Date().getFullYear();
    dialogueCreation.showModal();
  });

  formulaireCreation.elements.titre.addEventListener('input', () => {
    if (slugModifieALaMain) {
      return;
    }
    const base = slugifier(formulaireCreation.elements.titre.value);
    formulaireCreation.elements.slug.value = base ? `${base}-${suffixeCreation}` : '';
  });

  formulaireCreation.elements.slug.addEventListener('input', () => {
    slugModifieALaMain = true;
  });

  formulaireCreation.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    afficherErreur(formulaireCreation, '');
    await pendantEnvoi(formulaireCreation, async () => {
      try {
        const calendrier = await appelerApi('POST', '/admin/api/calendriers', lireChampsCalendrier(formulaireCreation));
        dialogueCreation.close();
        window.location.hash = `#/c/${calendrier.id}`;
      } catch (erreur) {
        afficherErreur(formulaireCreation, erreur.message);
      }
    });
  });

  // ---------- Édition d'un calendrier ----------

  async function afficherEdition(id) {
    calendrierEnCours = await appelerApi('GET', `/admin/api/calendriers/${encodeURIComponent(id)}`);
    remplirReglages();
    afficherGrilleJours();
  }

  function remplirReglages() {
    const calendrier = calendrierEnCours;
    document.getElementById('edition-titre').textContent = calendrier.titre;
    document.getElementById('lien-voir').href = `/c/${calendrier.slug}`;
    document.getElementById('lien-apercu').href = `/c/${calendrier.slug}?apercu=1`;

    const champs = formulaireReglages.elements;
    champs.titre.value = calendrier.titre;
    champs.slug.value = calendrier.slug;
    champs.annee.value = calendrier.annee;
    champs.message.value = calendrier.message || '';
    champs.modeTest.checked = calendrier.modeTest === true;
    afficherErreur(formulaireReglages, '');
    desarmerSuppression();
  }

  formulaireReglages.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    afficherErreur(formulaireReglages, '');
    await pendantEnvoi(formulaireReglages, async () => {
      try {
        const misAJour = await appelerApi(
          'PUT',
          `/admin/api/calendriers/${calendrierEnCours.id}`,
          lireChampsCalendrier(formulaireReglages)
        );
        calendrierEnCours = misAJour;
        remplirReglages();
        notifier('Réglages enregistrés');
      } catch (erreur) {
        afficherErreur(formulaireReglages, erreur.message);
      }
    });
  });

  document.getElementById('bouton-copier').addEventListener('click', async () => {
    const adresse = adressePublique(calendrierEnCours.slug);
    try {
      await navigator.clipboard.writeText(adresse);
      notifier('Lien copié');
    } catch {
      // Le presse-papiers n'est disponible qu'en HTTPS ou sur localhost
      window.prompt('Copiez ce lien :', adresse);
    }
  });

  // Suppression en deux temps, sans fenêtre de confirmation
  const boutonSupprimer = document.getElementById('bouton-supprimer');
  let minuterieSuppression = null;

  function desarmerSuppression() {
    clearTimeout(minuterieSuppression);
    boutonSupprimer.classList.remove('est-arme');
    boutonSupprimer.textContent = 'Supprimer ce calendrier';
  }

  boutonSupprimer.addEventListener('click', async () => {
    if (!boutonSupprimer.classList.contains('est-arme')) {
      boutonSupprimer.classList.add('est-arme');
      boutonSupprimer.textContent = 'Toucher encore pour confirmer';
      minuterieSuppression = setTimeout(desarmerSuppression, 4000);
      return;
    }
    desarmerSuppression();
    await appelerApi('DELETE', `/admin/api/calendriers/${calendrierEnCours.id}`);
    notifier('Calendrier supprimé');
    window.location.hash = '#/';
  });

  // ---------- Grille des 24 cases ----------

  function afficherGrilleJours() {
    const grille = document.getElementById('grille-jours');
    grille.replaceChildren();

    for (const jour of calendrierEnCours.jours) {
      const element = document.createElement('li');
      const tuile = document.createElement('button');
      tuile.type = 'button';
      tuile.className = 'tuile';
      tuile.setAttribute('aria-label', `Case ${jour.numero}`);

      const numero = document.createElement('span');
      numero.className = 'tuile-numero';
      numero.textContent = jour.numero;
      tuile.appendChild(numero);

      if (jour.image) {
        const image = document.createElement('img');
        image.src = `/uploads/${jour.image}`;
        image.alt = '';
        image.loading = 'lazy';
        tuile.appendChild(image);
        if (jour.texte) {
          const drapeau = document.createElement('span');
          drapeau.className = 'tuile-texte';
          drapeau.textContent = 'texte';
          tuile.appendChild(drapeau);
        }
      } else if (jour.texte) {
        const extrait = document.createElement('span');
        extrait.className = 'tuile-extrait';
        extrait.textContent = jour.texte;
        tuile.appendChild(extrait);
      } else {
        tuile.classList.add('tuile--vide');
      }

      tuile.addEventListener('click', () => ouvrirDialogueJour(jour));
      element.appendChild(tuile);
      grille.appendChild(element);
    }
  }

  // ---------- Édition d'une case ----------

  let jourEnCours = null;
  let imageChoisie = null; // Blob prêt à envoyer
  let retirerImage = false;
  let adresseApercuTemporaire = null;

  const apercuImage = document.getElementById('jour-apercu-image');
  const apercuVide = document.getElementById('jour-apercu-vide');
  const champFichier = document.getElementById('jour-fichier');
  const boutonRetirerImage = document.getElementById('jour-retirer-image');

  function montrerApercu(adresse) {
    if (adresse) {
      apercuImage.src = adresse;
      apercuImage.hidden = false;
      apercuVide.hidden = true;
      boutonRetirerImage.hidden = false;
    } else {
      apercuImage.removeAttribute('src');
      apercuImage.hidden = true;
      apercuVide.hidden = false;
      boutonRetirerImage.hidden = true;
    }
  }

  function libererApercuTemporaire() {
    if (adresseApercuTemporaire) {
      URL.revokeObjectURL(adresseApercuTemporaire);
      adresseApercuTemporaire = null;
    }
  }

  function ouvrirDialogueJour(jour) {
    jourEnCours = jour;
    imageChoisie = null;
    retirerImage = false;
    libererApercuTemporaire();
    champFichier.value = '';

    document.getElementById('jour-titre').textContent = `Case du ${jour.numero === 1 ? '1er' : jour.numero} décembre`;
    formulaireJour.elements.texte.value = jour.texte || '';
    montrerApercu(jour.image ? `/uploads/${jour.image}` : null);
    afficherErreur(formulaireJour, '');
    dialogueJour.showModal();
  }

  champFichier.addEventListener('change', async () => {
    const fichier = champFichier.files[0];
    if (!fichier) {
      return;
    }
    afficherErreur(formulaireJour, '');
    try {
      imageChoisie = await reduireImage(fichier);
      retirerImage = false;
      libererApercuTemporaire();
      adresseApercuTemporaire = URL.createObjectURL(imageChoisie);
      montrerApercu(adresseApercuTemporaire);
    } catch {
      afficherErreur(formulaireJour, "Impossible de lire cette image.");
    }
  });

  boutonRetirerImage.addEventListener('click', () => {
    imageChoisie = null;
    retirerImage = true;
    champFichier.value = '';
    libererApercuTemporaire();
    montrerApercu(null);
  });

  formulaireJour.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    afficherErreur(formulaireJour, '');

    const donnees = new FormData();
    donnees.append('texte', formulaireJour.elements.texte.value);
    if (imageChoisie) {
      const extension = imageChoisie.type === 'image/gif' ? 'gif' : imageChoisie.type.split('/')[1];
      donnees.append('image', imageChoisie, `image.${extension}`);
    } else if (retirerImage) {
      donnees.append('supprimerImage', '1');
    }

    await pendantEnvoi(formulaireJour, async () => {
      try {
        const adresse = `/admin/api/calendriers/${calendrierEnCours.id}/jours/${jourEnCours.numero}`;
        const jourMisAJour = await appelerApi('PUT', adresse, donnees);
        Object.assign(jourEnCours, jourMisAJour);
        afficherGrilleJours();
        dialogueJour.close();
        notifier(`Case ${jourEnCours.numero} enregistrée`);
      } catch (erreur) {
        afficherErreur(formulaireJour, erreur.message);
      }
    });
  });

  dialogueJour.addEventListener('close', libererApercuTemporaire);

  // Les photos de téléphone sont énormes : on les réduit avant l'envoi
  async function reduireImage(fichier) {
    if (fichier.type === 'image/gif') {
      return fichier; // on garde l'animation
    }

    const image = await chargerImage(fichier);
    const coteLePlusLong = Math.max(image.naturalWidth, image.naturalHeight);
    const dejaLegere = coteLePlusLong <= TAILLE_MAX_IMAGE && fichier.size < 1.5 * 1024 * 1024;
    if (dejaLegere) {
      return fichier;
    }

    const echelle = Math.min(1, TAILLE_MAX_IMAGE / coteLePlusLong);
    const canevas = document.createElement('canvas');
    canevas.width = Math.round(image.naturalWidth * echelle);
    canevas.height = Math.round(image.naturalHeight * echelle);
    const contexte = canevas.getContext('2d');
    contexte.fillStyle = '#ffffff'; // fond blanc pour les PNG transparents
    contexte.fillRect(0, 0, canevas.width, canevas.height);
    contexte.drawImage(image, 0, 0, canevas.width, canevas.height);

    return new Promise((resolve, reject) => {
      canevas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Conversion impossible'))), 'image/jpeg', 0.85);
    });
  }

  function chargerImage(fichier) {
    return new Promise((resolve, reject) => {
      const adresse = URL.createObjectURL(fichier);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(adresse);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(adresse);
        reject(new Error('Image illisible'));
      };
      image.src = adresse;
    });
  }

  // ---------- Fermeture des dialogues ----------

  for (const bouton of document.querySelectorAll('[data-fermer]')) {
    bouton.addEventListener('click', () => bouton.closest('dialog').close());
  }

  // ---------- Navigation ----------

  // Si on change de page pendant un chargement, seule la dernière navigation s'affiche
  let compteurNavigation = 0;

  async function naviguer() {
    compteurNavigation++;
    const cetteNavigation = compteurNavigation;
    const chemin = window.location.hash.replace(/^#/, '') || '/';
    const correspondance = chemin.match(/^\/c\/([\w-]+)$/);
    try {
      if (correspondance) {
        await afficherEdition(correspondance[1]);
      } else {
        await afficherListe();
      }
      if (cetteNavigation === compteurNavigation) {
        afficherVue(correspondance ? 'edition' : 'liste');
      }
    } catch (erreur) {
      if (erreur instanceof ErreurNonConnecte) {
        return;
      }
      notifier(erreur.message);
      if (correspondance) {
        window.location.hash = '#/';
      }
    }
  }

  async function demarrer() {
    window.addEventListener('hashchange', naviguer);

    const session = await appelerApi('GET', '/admin/api/session');
    if (session.connecte) {
      naviguer();
    } else {
      afficherVue('connexion');
    }
  }

  demarrer();
})();
