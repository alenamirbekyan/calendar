// Backoffice : comptes, calendriers, liens d'accès et 24 cases.
'use strict';

(function () {
  const TAILLE_MAX_IMAGE = 1600; // en pixels, côté le plus long

  const vues = {
    connexion: document.getElementById('vue-connexion'),
    liste: document.getElementById('vue-liste'),
    edition: document.getElementById('vue-edition'),
    compte: document.getElementById('vue-compte'),
    comptes: document.getElementById('vue-comptes'),
  };

  const barreMenu = document.getElementById('barre-menu');
  const dialogueCreation = document.getElementById('dialogue-creation');
  const formulaireCreation = document.getElementById('formulaire-creation');
  const formulaireReglages = document.getElementById('formulaire-reglages');
  const formulaireLien = document.getElementById('formulaire-lien');
  const dialogueJour = document.getElementById('dialogue-jour');
  const formulaireJour = document.getElementById('formulaire-jour');
  const formulaireMonMotDePasse = document.getElementById('formulaire-mon-mot-de-passe');
  const formulaireNouveauCompte = document.getElementById('formulaire-nouveau-compte');
  const dialogueMotDePasse = document.getElementById('dialogue-mot-de-passe');
  const formulaireMotDePasse = document.getElementById('formulaire-mot-de-passe');

  let sessionEnCours = null; // { identifiant, estSuperAdmin }
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
      sessionEnCours = null;
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
    barreMenu.hidden = nom === 'connexion';
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

  function adresseDuLien(jeton) {
    return `${window.location.origin}/c/${jeton}`;
  }

  function formaterDate(texteIso) {
    return new Date(texteIso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formaterDateEtHeure(texteIso) {
    return new Date(texteIso).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function copier(texte) {
    try {
      await navigator.clipboard.writeText(texte);
      notifier('Lien copié');
    } catch {
      // Le presse-papiers n'est disponible qu'en HTTPS ou sur localhost
      window.prompt('Copiez ce lien :', texte);
    }
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

  // Action destructrice en deux temps, sans fenêtre de confirmation :
  // premier appui = armer, second appui dans les 4 secondes = exécuter.
  function boutonADoubleConfirmation(bouton, libelle, action) {
    let minuterie = null;

    function desarmer() {
      clearTimeout(minuterie);
      bouton.classList.remove('est-arme');
      bouton.textContent = libelle;
    }

    bouton.textContent = libelle;
    bouton.addEventListener('click', async () => {
      if (!bouton.classList.contains('est-arme')) {
        bouton.classList.add('est-arme');
        bouton.textContent = 'Toucher encore pour confirmer';
        minuterie = setTimeout(desarmer, 4000);
        return;
      }
      desarmer();
      bouton.disabled = true;
      try {
        await action();
      } catch (erreur) {
        if (!(erreur instanceof ErreurNonConnecte)) {
          notifier(erreur.message);
        }
      } finally {
        bouton.disabled = false;
      }
    });

    return desarmer;
  }

  function creerBouton(libelle, classes) {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = classes;
    bouton.textContent = libelle;
    return bouton;
  }

  // Les champs du calendrier sont partagés entre création et réglages
  function insererChampsCalendrier() {
    const modele = document.getElementById('modele-champs-calendrier');
    for (const conteneur of document.querySelectorAll('[data-champs-calendrier]')) {
      conteneur.appendChild(modele.content.cloneNode(true));
    }
  }

  // Insertion immédiate : les écouteurs ci-dessous ont besoin de ces champs
  insererChampsCalendrier();

  function lireChampsCalendrier(formulaire) {
    return {
      titre: formulaire.elements.titre.value,
      annee: Number(formulaire.elements.annee.value),
      message: formulaire.elements.message.value,
      modeTest: formulaire.elements.modeTest.checked,
    };
  }

  // ---------- Session ----------

  function appliquerSession(session) {
    sessionEnCours = session;
    document.getElementById('lien-mon-compte').textContent = session.identifiant;
    document.getElementById('lien-comptes').hidden = !session.estSuperAdmin;
  }

  async function chargerSession() {
    const session = await appelerApi('GET', '/admin/api/session');
    if (session.connecte) {
      appliquerSession(session);
      return true;
    }
    return false;
  }

  document.getElementById('formulaire-connexion').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.target;
    afficherErreur(formulaire, '');
    await pendantEnvoi(formulaire, async () => {
      try {
        await appelerApi('POST', '/admin/api/connexion', {
          identifiant: formulaire.elements.identifiant.value,
          motDePasse: formulaire.elements.motDePasse.value,
        });
        formulaire.reset();
        await chargerSession();
        // Changer le hash déclenche déjà la navigation
        if (window.location.hash === '#/') {
          naviguer();
        } else {
          window.location.hash = '#/';
        }
      } catch (erreur) {
        afficherErreur(formulaire, erreur.message);
      }
    });
  });

  document.getElementById('bouton-deconnexion').addEventListener('click', async () => {
    await appelerApi('POST', '/admin/api/deconnexion');
    sessionEnCours = null;
    afficherVue('connexion');
  });

  // ---------- Liste des calendriers ----------

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

      const infos = document.createElement('span');
      infos.className = 'fiche-adresse';
      const libelleLiens = calendrier.nombreLiens === 1 ? '1 lien' : `${calendrier.nombreLiens} liens`;
      infos.textContent = `${calendrier.annee} · ${libelleLiens}`;

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
      const lienApercu = document.createElement('a');
      lienApercu.className = 'bouton';
      lienApercu.href = `/apercu/${calendrier.id}`;
      lienApercu.target = '_blank';
      lienApercu.rel = 'noopener';
      lienApercu.textContent = 'Aperçu';
      actions.append(lienModifier, lienApercu);

      fiche.append(titre, infos, progression, compteur, actions);
      liste.appendChild(fiche);
    }
  }

  // ---------- Création d'un calendrier ----------

  document.getElementById('bouton-nouveau').addEventListener('click', () => {
    formulaireCreation.reset();
    afficherErreur(formulaireCreation, '');
    formulaireCreation.elements.annee.value = new Date().getFullYear();
    dialogueCreation.showModal();
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
    afficherLiens();
    afficherGrilleJours();
  }

  function remplirReglages() {
    const calendrier = calendrierEnCours;
    document.getElementById('edition-titre').textContent = calendrier.titre;
    document.getElementById('lien-apercu').href = `/apercu/${calendrier.id}`;

    const champs = formulaireReglages.elements;
    champs.titre.value = calendrier.titre;
    champs.annee.value = calendrier.annee;
    champs.message.value = calendrier.message || '';
    champs.modeTest.checked = calendrier.modeTest === true;
    afficherErreur(formulaireReglages, '');
    desarmerSuppressionCalendrier();
  }

  formulaireReglages.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    afficherErreur(formulaireReglages, '');
    await pendantEnvoi(formulaireReglages, async () => {
      try {
        calendrierEnCours = await appelerApi(
          'PUT',
          `/admin/api/calendriers/${calendrierEnCours.id}`,
          lireChampsCalendrier(formulaireReglages)
        );
        remplirReglages();
        afficherLiens();
        notifier('Réglages enregistrés');
      } catch (erreur) {
        afficherErreur(formulaireReglages, erreur.message);
      }
    });
  });

  const desarmerSuppressionCalendrier = boutonADoubleConfirmation(
    document.getElementById('bouton-supprimer'),
    'Supprimer ce calendrier',
    async () => {
      await appelerApi('DELETE', `/admin/api/calendriers/${calendrierEnCours.id}`);
      notifier('Calendrier supprimé');
      window.location.hash = '#/';
    }
  );

  // ---------- Liens d'accès ----------

  function afficherLiens() {
    const liste = document.getElementById('liste-liens');
    liste.replaceChildren();
    document.getElementById('liens-vide').hidden = calendrierEnCours.liens.length > 0;

    for (const lien of calendrierEnCours.liens) {
      const element = document.createElement('li');
      element.className = 'lien-acces';

      const nom = document.createElement('strong');
      nom.textContent = lien.nom;

      const adresse = document.createElement('code');
      adresse.className = 'lien-adresse';
      adresse.textContent = adresseDuLien(lien.jeton);

      const visite = document.createElement('small');
      visite.className = 'fiche-adresse';
      const texteVisite = lien.derniereVisite
        ? `dernière visite le ${formaterDateEtHeure(lien.derniereVisite)}`
        : 'jamais ouvert';
      const texteOuvertures = lien.casesOuvertes === 1 ? '1 case ouverte' : `${lien.casesOuvertes} cases ouvertes`;
      visite.textContent = `Créé le ${formaterDate(lien.creeLe)} · ${texteVisite} · ${texteOuvertures}`;

      const actions = document.createElement('div');
      actions.className = 'lien-actions';

      const boutonCopier = creerBouton('Copier', 'bouton');
      boutonCopier.addEventListener('click', () => copier(adresseDuLien(lien.jeton)));

      // Pas de bouton « Ouvrir » : visiter le lien d'un destinataire fausserait son suivi
      // (dernière visite, cases ouvertes). Pour vérifier le rendu, il y a « Aperçu complet ».

      const boutonSupprimer = creerBouton('', 'bouton bouton--danger');
      boutonADoubleConfirmation(boutonSupprimer, 'Supprimer', async () => {
        await appelerApi('DELETE', `/admin/api/calendriers/${calendrierEnCours.id}/liens/${lien.id}`);
        calendrierEnCours.liens = calendrierEnCours.liens.filter((autre) => autre.id !== lien.id);
        afficherLiens();
        notifier('Lien désactivé');
      });

      actions.append(boutonCopier, boutonSupprimer);
      element.append(nom, adresse, visite, actions);
      liste.appendChild(element);
    }
  }

  formulaireLien.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    afficherErreur(formulaireLien, '');
    await pendantEnvoi(formulaireLien, async () => {
      try {
        const lien = await appelerApi('POST', `/admin/api/calendriers/${calendrierEnCours.id}/liens`, {
          nom: formulaireLien.elements.nom.value,
        });
        calendrierEnCours.liens.push(lien);
        formulaireLien.reset();
        afficherLiens();
        await copier(adresseDuLien(lien.jeton));
      } catch (erreur) {
        afficherErreur(formulaireLien, erreur.message);
      }
    });
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
      afficherErreur(formulaireJour, 'Impossible de lire cette image.');
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

  // ---------- Mon compte ----------

  function afficherMonCompte() {
    formulaireMonMotDePasse.reset();
    formulaireMonMotDePasse.elements.identifiant.value = sessionEnCours.identifiant;
    afficherErreur(formulaireMonMotDePasse, '');
  }

  formulaireMonMotDePasse.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const champs = formulaireMonMotDePasse.elements;
    afficherErreur(formulaireMonMotDePasse, '');
    if (champs.nouveau.value !== champs.confirmation.value) {
      afficherErreur(formulaireMonMotDePasse, 'Les deux nouveaux mots de passe ne sont pas identiques.');
      return;
    }
    await pendantEnvoi(formulaireMonMotDePasse, async () => {
      try {
        await appelerApi('PUT', '/admin/api/mon-compte/mot-de-passe', {
          actuel: champs.actuel.value,
          nouveau: champs.nouveau.value,
        });
        afficherMonCompte();
        notifier('Mot de passe changé');
      } catch (erreur) {
        afficherErreur(formulaireMonMotDePasse, erreur.message);
      }
    });
  });

  // ---------- Comptes admin (super admin) ----------

  async function afficherComptes() {
    const comptes = await appelerApi('GET', '/admin/api/comptes');
    const liste = document.getElementById('liste-comptes');
    liste.replaceChildren();

    for (const compte of comptes) {
      const element = document.createElement('li');
      element.className = 'compte';

      const nom = document.createElement('strong');
      nom.textContent = compte.identifiant;
      if (compte.estSuperAdmin) {
        const badge = document.createElement('span');
        badge.className = 'badge-role';
        badge.textContent = 'super admin';
        nom.append(' ', badge);
      }

      const infos = document.createElement('small');
      infos.className = 'fiche-adresse';
      const libelleCalendriers =
        compte.nombreCalendriers === 1 ? '1 calendrier' : `${compte.nombreCalendriers} calendriers`;
      infos.textContent = `${libelleCalendriers} · créé le ${formaterDate(compte.creeLe)}`;

      element.append(nom, infos);

      if (compte.estMoi) {
        const moi = document.createElement('small');
        moi.className = 'fiche-adresse';
        moi.textContent = "C'est vous. Changez votre mot de passe dans « Mon compte ».";
        element.appendChild(moi);
      } else {
        const actions = document.createElement('div');
        actions.className = 'lien-actions';

        const boutonMotDePasse = creerBouton('Nouveau mot de passe', 'bouton');
        boutonMotDePasse.addEventListener('click', () => ouvrirDialogueMotDePasse(compte));

        const boutonSupprimer = creerBouton('', 'bouton bouton--danger');
        boutonADoubleConfirmation(boutonSupprimer, 'Supprimer (et ses calendriers)', async () => {
          await appelerApi('DELETE', `/admin/api/comptes/${compte.id}`);
          notifier(`Compte « ${compte.identifiant} » supprimé`);
          await afficherComptes();
        });

        actions.append(boutonMotDePasse, boutonSupprimer);
        element.appendChild(actions);
      }

      liste.appendChild(element);
    }
  }

  formulaireNouveauCompte.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const champs = formulaireNouveauCompte.elements;
    afficherErreur(formulaireNouveauCompte, '');
    await pendantEnvoi(formulaireNouveauCompte, async () => {
      try {
        const compte = await appelerApi('POST', '/admin/api/comptes', {
          identifiant: champs.identifiant.value,
          motDePasse: champs.motDePasse.value,
          estSuperAdmin: champs.estSuperAdmin.checked,
        });
        formulaireNouveauCompte.reset();
        notifier(`Compte « ${compte.identifiant} » créé`);
        await afficherComptes();
      } catch (erreur) {
        afficherErreur(formulaireNouveauCompte, erreur.message);
      }
    });
  });

  let compteEnCours = null;

  function ouvrirDialogueMotDePasse(compte) {
    compteEnCours = compte;
    formulaireMotDePasse.reset();
    afficherErreur(formulaireMotDePasse, '');
    document.getElementById('mot-de-passe-titre').textContent = `Mot de passe de « ${compte.identifiant} »`;
    dialogueMotDePasse.showModal();
  }

  formulaireMotDePasse.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    afficherErreur(formulaireMotDePasse, '');
    await pendantEnvoi(formulaireMotDePasse, async () => {
      try {
        await appelerApi('PUT', `/admin/api/comptes/${compteEnCours.id}/mot-de-passe`, {
          motDePasse: formulaireMotDePasse.elements.motDePasse.value,
        });
        dialogueMotDePasse.close();
        notifier('Mot de passe changé');
      } catch (erreur) {
        afficherErreur(formulaireMotDePasse, erreur.message);
      }
    });
  });

  // ---------- Fermeture des dialogues ----------

  for (const bouton of document.querySelectorAll('[data-fermer]')) {
    bouton.addEventListener('click', () => bouton.closest('dialog').close());
  }

  // ---------- Navigation ----------

  // Si on change de page pendant un chargement, seule la dernière navigation s'affiche
  let compteurNavigation = 0;

  async function naviguer() {
    if (!sessionEnCours) {
      afficherVue('connexion');
      return;
    }

    compteurNavigation++;
    const cetteNavigation = compteurNavigation;
    const chemin = window.location.hash.replace(/^#/, '') || '/';
    const correspondanceCalendrier = chemin.match(/^\/c\/([\w-]+)$/);

    let vueAAfficher = 'liste';
    try {
      if (correspondanceCalendrier) {
        await afficherEdition(correspondanceCalendrier[1]);
        vueAAfficher = 'edition';
      } else if (chemin === '/compte') {
        afficherMonCompte();
        vueAAfficher = 'compte';
      } else if (chemin === '/comptes' && sessionEnCours.estSuperAdmin) {
        await afficherComptes();
        vueAAfficher = 'comptes';
      } else {
        await afficherListe();
      }
      if (cetteNavigation === compteurNavigation) {
        afficherVue(vueAAfficher);
      }
    } catch (erreur) {
      if (erreur instanceof ErreurNonConnecte) {
        return;
      }
      notifier(erreur.message);
      if (chemin !== '/') {
        window.location.hash = '#/';
      }
    }
  }

  async function demarrer() {
    window.addEventListener('hashchange', naviguer);
    await chargerSession();
    naviguer();
  }

  demarrer();
})();
