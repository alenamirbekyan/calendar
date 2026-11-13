// Page publique d'un calendrier de l'Avent.
'use strict';

(function () {
  // Disposition des 24 cases : p = petite, g = grande (2x2), h = haute (1x2), l = large (2x1).
  // Cette séquence remplit la grille sans trou en 3 comme en 4 colonnes.
  const DISPOSITION = 'hhpplppphpgplpphpppgpppp';
  const CLASSES_DE_TAILLE = { p: '', g: 'case--grande', h: 'case--haute', l: 'case--large' };
  const COULEURS = ['canneberge', 'sapin', 'creme', 'kraft', 'minuit'];
  const MOTIFS = ['etoile', 'flocon', 'houx', 'sapin', 'lune', 'cadeau'];
  const TAQUINERIES = ['Patience !', 'Pas si vite, petit lutin !', 'Hop hop hop !', 'Le Père Noël a tout vu...', 'Tss tss...'];

  const elements = {
    titre: document.getElementById('titre'),
    message: document.getElementById('message'),
    statut: document.getElementById('statut'),
    progression: document.getElementById('progression'),
    plateau: document.getElementById('plateau'),
    introuvable: document.getElementById('introuvable'),
    carte: document.getElementById('carte'),
    carteDate: document.getElementById('carte-date'),
    carteNoel: document.getElementById('carte-noel'),
    carteFigure: document.getElementById('carte-figure'),
    carteImage: document.getElementById('carte-image'),
    carteTexte: document.getElementById('carte-texte'),
    bulle: document.getElementById('bulle'),
    installer: document.getElementById('installer'),
    installerTexte: document.getElementById('installer-texte'),
    installerBouton: document.getElementById('installer-bouton'),
    installerFermer: document.getElementById('installer-fermer'),
  };

  const mouvementReduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Deux adresses possibles :
  //   /c/<jeton>     lien d'un destinataire
  //   /apercu/<id>   aperçu complet, réservé à l'admin propriétaire
  const morceauxDuChemin = window.location.pathname.split('/');
  const typeDePage = morceauxDuChemin[1];
  const identifiantDansLUrl = encodeURIComponent(decodeURIComponent(morceauxDuChemin[2] || ''));
  const adresseApi =
    typeDePage === 'apercu'
      ? `/admin/api/calendriers/${identifiantDansLUrl}/apercu`
      : `/api/c/${identifiantDansLUrl}`;

  let calendrier = null;
  let casesOuvertes = new Set();

  // ---------- Hasard reproductible : même mélange à chaque visite ----------

  function empreinteDuTexte(texte) {
    let empreinte = 2166136261;
    for (let i = 0; i < texte.length; i++) {
      empreinte = Math.imul(empreinte ^ texte.charCodeAt(i), 16777619);
    }
    return empreinte >>> 0;
  }

  function creerHasard(graine) {
    let etat = graine;
    return function () {
      etat = (etat + 0x6d2b79f5) >>> 0;
      let t = etat;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function melanger(liste, hasard) {
    const copie = [...liste];
    for (let i = copie.length - 1; i > 0; i--) {
      const j = Math.floor(hasard() * (i + 1));
      [copie[i], copie[j]] = [copie[j], copie[i]];
    }
    return copie;
  }

  // ---------- Mémoire des cases déjà ouvertes (sur le serveur, par lien) ----------

  // En aperçu ou en test, on ne mémorise rien : les portes seront bien fermées le jour venu
  function toutEstOuvertPourEssai() {
    return calendrier.apercu || calendrier.modeTest;
  }

  function lireCasesOuvertes() {
    if (toutEstOuvertPourEssai()) {
      return new Set();
    }
    return new Set(calendrier.casesOuvertes || []);
  }

  function memoriserOuverture(numero) {
    if (toutEstOuvertPourEssai() || typeDePage !== 'c') {
      return;
    }
    const adresse = `/api/c/${identifiantDansLUrl}/ouvertures/${numero}`;
    // Sans réponse attendue : si l'envoi échoue, la case s'ouvre quand même à l'écran
    fetch(adresse, { method: 'POST' }).catch(() => {});
  }

  // ---------- Dates ----------

  function dateLocaleDepuisIso(texteIso) {
    const [annee, mois, jour] = texteIso.split('-').map(Number);
    return new Date(annee, mois - 1, jour);
  }

  function joursAvant(numero) {
    const aujourdhui = dateLocaleDepuisIso(calendrier.aujourdhui);
    const dateDeLaCase = new Date(calendrier.annee, 11, numero);
    return Math.round((dateDeLaCase - aujourdhui) / 86400000);
  }

  function libelleDuJour(numero) {
    return numero === 1 ? '1er décembre' : `${numero} décembre`;
  }

  // ---------- Affichage ----------

  function afficherEntete() {
    document.title = calendrier.titre;
    elements.titre.textContent = calendrier.titre;
    elements.message.textContent = calendrier.message || '';

    let statut = '';
    if (calendrier.apercu) {
      statut = 'Mode aperçu : toutes les cases sont ouvrables';
    } else if (calendrier.modeTest) {
      statut = 'Mode test : les dates sont ignorées';
    } else if (calendrier.etat === 'avant') {
      const n = calendrier.joursAvantOuverture;
      statut = n === 1 ? 'Ça commence demain !' : `Première case dans ${n} jours`;
    } else if (calendrier.etat === 'pendant') {
      statut = `Nous sommes le ${libelleDuJour(calendrier.jourCourant)}`;
    } else {
      statut = 'Joyeux Noël ! Toutes les cases sont ouvertes.';
    }
    elements.statut.textContent = statut;
    afficherProgression();
  }

  // « 5 cases ouvertes sur 24 », sous le statut
  function afficherProgression() {
    const nombre = casesOuvertes.size;
    if (toutEstOuvertPourEssai() || nombre === 0) {
      elements.progression.textContent = '';
      return;
    }
    const total = calendrier.jours.length;
    elements.progression.textContent =
      nombre === 1 ? `1 case ouverte sur ${total}` : `${nombre} cases ouvertes sur ${total}`;
  }

  function construireCase(jour, position, hasard, couleurPrecedente) {
    const tailleCode = DISPOSITION[position];

    // Une couleur différente de la case précédente
    const couleursPossibles = COULEURS.filter((couleur) => couleur !== couleurPrecedente);
    const couleur = couleursPossibles[Math.floor(hasard() * couleursPossibles.length)];
    const style = Math.floor(hasard() * 4);
    const motif = MOTIFS[Math.floor(hasard() * MOTIFS.length)];

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = `case case--${couleur} case--style-${style} ${CLASSES_DE_TAILLE[tailleCode]}`;
    bouton.dataset.numero = jour.numero;
    bouton.style.setProperty('--delai', `${position * 0.03}s`);
    bouton.setAttribute('aria-label', `Case du ${libelleDuJour(jour.numero)}`);

    const creux = document.createElement('span');
    creux.className = 'case-creux';
    if (jour.ouvrable) {
      if (jour.image) {
        const vignette = document.createElement('img');
        vignette.className = 'case-polaroid';
        vignette.src = jour.image;
        vignette.alt = '';
        vignette.loading = 'lazy';
        creux.appendChild(vignette);
        creux.insertAdjacentHTML(
          'beforeend',
          '<svg class="case-punaise" aria-hidden="true"><use href="#motif-etoile"/></svg>'
        );
      } else if (jour.texte && jour.texte.trim()) {
        // Pas d'image : un extrait du mot, visible dans l'entrebâillement de la porte
        const extrait = document.createElement('span');
        extrait.className = 'case-extrait';
        extrait.textContent = jour.texte.trim();
        creux.appendChild(extrait);
      } else {
        creux.innerHTML = '<svg aria-hidden="true"><use href="#motif-etoile"/></svg>';
      }
    }

    const numeroHtml = style === 3 ? `<span>${jour.numero}</span>` : String(jour.numero);
    const porte = document.createElement('span');
    porte.className = 'case-porte';
    porte.innerHTML = `
      <span class="case-face">
        <svg class="case-motif" aria-hidden="true"><use href="#motif-${motif}"/></svg>
        <span class="case-numero">${numeroHtml}</span>
      </span>
      <span class="case-dos"></span>`;

    bouton.append(creux, porte);

    if (jour.ouvrable) {
      bouton.classList.add('est-ouvrable');
    }
    if (casesOuvertes.has(jour.numero) && jour.ouvrable) {
      bouton.classList.add('est-ouverte');
    }
    if (!toutEstOuvertPourEssai() && calendrier.jourCourant === jour.numero) {
      bouton.classList.add('est-du-jour');
      const etiquette = document.createElement('span');
      etiquette.className = 'case-etiquette';
      etiquette.textContent = "aujourd'hui";
      bouton.appendChild(etiquette);
    }

    bouton.addEventListener('click', () => surClicCase(bouton, jour));
    return { bouton, couleur };
  }

  function construireGrille() {
    const hasard = creerHasard(empreinteDuTexte(calendrier.graine));
    const joursMelanges = melanger(calendrier.jours, hasard);

    const grille = document.createElement('div');
    grille.className = 'grille';

    let couleurPrecedente = null;
    joursMelanges.forEach((jour, position) => {
      const resultat = construireCase(jour, position, hasard, couleurPrecedente);
      couleurPrecedente = resultat.couleur;
      grille.appendChild(resultat.bouton);
    });

    elements.plateau.replaceChildren(grille);
  }

  // ---------- Interactions ----------

  function surClicCase(bouton, jour) {
    if (!jour.ouvrable) {
      // Seule la prochaine case peut s'être débloquée depuis le chargement de la page
      // (minuit est passé) : pour elle, on pose la question au serveur.
      if (typeDePage === 'c' && jour.numero === numeroDeLaProchaineCaseFermee()) {
        demanderOuvertureAuServeur(bouton, jour.numero);
      } else {
        refuserOuverture(bouton, jour.numero);
      }
      return;
    }
    if (bouton.classList.contains('est-ouverte')) {
      afficherCarte(jour);
      return;
    }

    bouton.classList.add('est-ouverte');
    casesOuvertes.add(jour.numero);
    memoriserOuverture(jour.numero);
    afficherProgression();
    lancerEtincelles(bouton);
    setTimeout(() => {
      afficherCarte(jour);
      if (jour.numero === DERNIER_JOUR) {
        celebrerLaFin();
      }
    }, mouvementReduit ? 150 : 700);
  }

  // ---------- Final : la dernière case vient d'être ouverte ----------

  const DERNIER_JOUR = 24;
  let finaleEnAttente = false;

  function celebrerLaFin() {
    lancerPluieDEtoiles();
    // Le message de fin s'affiche quand on referme la carte
    finaleEnAttente = true;
  }

  // La pluie est ajoutée dans la fenêtre de la carte : sinon elle passerait
  // sous le fond assombri, qui est toujours au premier plan. Placée avant le papier,
  // elle tombe derrière la carte et ne gêne pas la lecture.
  function lancerPluieDEtoiles() {
    if (mouvementReduit) {
      return;
    }
    const pluie = document.createElement('div');
    pluie.className = 'pluie';
    pluie.setAttribute('aria-hidden', 'true');

    const couleurs = ['#e2bd6b', '#f4ead6', '#ffd36b', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const etoile = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      etoile.setAttribute('class', 'etoile-qui-tombe');
      etoile.innerHTML = '<use href="#motif-etoile"/>';
      const taille = 10 + Math.random() * 18;
      etoile.style.left = `${Math.random() * 100}%`;
      etoile.style.width = `${taille}px`;
      etoile.style.height = `${taille}px`;
      etoile.style.color = couleurs[i % couleurs.length];
      etoile.style.setProperty('--derive', `${(Math.random() - 0.5) * 120}px`);
      etoile.style.animationDuration = `${2.6 + Math.random() * 2}s`;
      etoile.style.animationDelay = `${Math.random() * 1.8}s`;
      pluie.appendChild(etoile);
    }
    elements.carte.prepend(pluie);
    setTimeout(() => pluie.remove(), 7000);
  }

  elements.carte.addEventListener('close', () => {
    if (!finaleEnAttente) {
      return;
    }
    finaleEnAttente = false;
    const toutEstOuvert = casesOuvertes.size === calendrier.jours.length;
    const message = toutEstOuvert
      ? 'Joyeux Noël ! Les 24 cases sont ouvertes.'
      : 'Joyeux Noël ! Il reste des cases à rattraper...';
    afficherBulle(message, 6000);
  });

  function numeroDeLaProchaineCaseFermee() {
    const numerosFermes = calendrier.jours.filter((jour) => !jour.ouvrable).map((jour) => jour.numero);
    return Math.min(...numerosFermes);
  }

  // Le serveur décide avec sa propre date. S'il accepte, on recharge le calendrier
  // (statut, case du jour, contenu) puis on ouvre la porte.
  let demandeEnCours = false;

  async function demanderOuvertureAuServeur(bouton, numero) {
    if (demandeEnCours) {
      return;
    }
    demandeEnCours = true;
    try {
      const reponse = await fetch(`/api/c/${identifiantDansLUrl}/ouvertures/${numero}`, { method: 'POST' });
      const rechargementReussi = reponse.ok && (await chargerCalendrier(numero));
      if (!rechargementReussi) {
        refuserOuverture(bouton, numero);
        return;
      }
      const nouveauBouton = elements.plateau.querySelector(`.case[data-numero="${numero}"]`);
      const nouveauJour = calendrier.jours.find((jour) => jour.numero === numero);
      surClicCase(nouveauBouton, nouveauJour);
    } catch {
      refuserOuverture(bouton, numero);
    } finally {
      demandeEnCours = false;
    }
  }

  function refuserOuverture(bouton, numero) {
    bouton.classList.remove('gigote');
    // Force le navigateur à relancer l'animation
    void bouton.offsetWidth;
    bouton.classList.add('gigote');

    const restants = joursAvant(numero);
    const taquinerie = TAQUINERIES[Math.floor(Math.random() * TAQUINERIES.length)];
    if (restants === 1) {
      afficherBulle(`${taquinerie} Demain, encore un dodo.`);
    } else {
      afficherBulle(`${taquinerie} Encore ${restants} dodos.`);
    }
  }

  let minuterieBulle = null;
  function afficherBulle(texte, dureeEnMs = 2400) {
    elements.bulle.textContent = texte;
    elements.bulle.classList.add('est-visible');
    clearTimeout(minuterieBulle);
    minuterieBulle = setTimeout(() => elements.bulle.classList.remove('est-visible'), dureeEnMs);
  }

  function afficherCarte(jour) {
    elements.bulle.classList.remove('est-visible');
    elements.carteDate.textContent = libelleDuJour(jour.numero);
    elements.carteNoel.hidden = jour.numero !== DERNIER_JOUR;

    if (jour.image) {
      elements.carteImage.src = jour.image;
      elements.carteFigure.hidden = false;
    } else {
      elements.carteImage.removeAttribute('src');
      elements.carteFigure.hidden = true;
    }

    const texte = (jour.texte || '').trim();
    elements.carteTexte.classList.toggle('est-vide', !texte && !jour.image);
    if (texte) {
      elements.carteTexte.textContent = texte;
    } else if (!jour.image) {
      elements.carteTexte.textContent = 'Rien dans cette case... sauf un gros câlin.';
    } else {
      elements.carteTexte.textContent = '';
    }

    elements.carte.showModal();
  }

  function fermerCarte() {
    elements.carte.close();
  }

  elements.carte.addEventListener('click', (evenement) => {
    // Clic sur le fond sombre (en dehors du papier) ou sur le bouton fermer
    const clicSurLeFond = evenement.target === elements.carte;
    const clicSurFermer = evenement.target.closest('[data-fermer]') !== null;
    if (clicSurLeFond || clicSurFermer) {
      fermerCarte();
    }
  });

  function lancerEtincelles(bouton) {
    if (mouvementReduit) {
      return;
    }
    const zone = bouton.getBoundingClientRect();
    const centreX = zone.left + zone.width / 2;
    const centreY = zone.top + zone.height / 2;

    for (let i = 0; i < 14; i++) {
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const distance = 50 + Math.random() * 60;
      const etincelle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      etincelle.setAttribute('class', 'etincelle');
      etincelle.innerHTML = '<use href="#motif-etoile"/>';
      etincelle.style.left = `${centreX - 7}px`;
      etincelle.style.top = `${centreY - 7}px`;
      etincelle.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
      etincelle.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
      document.body.appendChild(etincelle);
      etincelle.addEventListener('animationend', () => etincelle.remove());
    }
  }

  function faireDefilerVersLaCaseDuJour() {
    const caseDuJour = elements.plateau.querySelector('.est-du-jour');
    if (!caseDuJour) {
      return;
    }
    const zone = caseDuJour.getBoundingClientRect();
    const estVisible = zone.top >= 0 && zone.bottom <= window.innerHeight;
    if (!estVisible) {
      caseDuJour.scrollIntoView({ behavior: mouvementReduit ? 'auto' : 'smooth', block: 'center' });
    }
  }

  // ---------- Guirlande lumineuse ----------

  function dessinerGuirlande() {
    const conteneur = document.getElementById('guirlande');
    const largeur = document.documentElement.clientWidth;
    const nombreDeFestons = Math.max(3, Math.round(largeur / 130));
    const largeurFeston = largeur / nombreDeFestons;
    const creux = 30;
    const couleurs = ['#ff5a4e', '#ffd36b', '#86e3a8', '#80c8ff', '#ffa0c0'];

    let chemin = 'M -10 6';
    let ampoules = '';
    let indexAmpoule = 0;

    for (let f = 0; f < nombreDeFestons; f++) {
      const x0 = f * largeurFeston;
      const x1 = x0 + largeurFeston;
      const xMilieu = (x0 + x1) / 2;
      chemin += ` L ${x0} 6 Q ${xMilieu} ${6 + creux * 2} ${x1} 6`;

      // Trois ampoules le long de chaque feston (courbe de Bézier quadratique)
      for (const t of [0.25, 0.5, 0.75]) {
        const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * xMilieu + t * t * x1;
        const y = (1 - t) * (1 - t) * 6 + 2 * (1 - t) * t * (6 + creux * 2) + t * t * 6;
        const couleur = couleurs[indexAmpoule % couleurs.length];
        const delai = (Math.random() * 2.8).toFixed(2);
        const inclinaison = Math.round((t - 0.5) * -50);
        ampoules += `
          <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${inclinaison})">
            <rect x="-2.5" y="-1" width="5" height="5" rx="1" fill="#3a463f"/>
            <ellipse class="ampoule" cx="0" cy="10" rx="4.6" ry="7" fill="${couleur}"
              filter="url(#lueur)" style="animation-delay:-${delai}s"/>
          </g>`;
        indexAmpoule++;
      }
    }

    conteneur.innerHTML = `
      <svg viewBox="0 0 ${largeur} 70" preserveAspectRatio="none">
        <defs>
          <filter id="lueur" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="3" result="flou"/>
            <feMerge><feMergeNode in="flou"/><feMergeNode in="flou"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <path d="${chemin}" fill="none" stroke="#2a3a33" stroke-width="1.6"/>
        ${ampoules}
      </svg>`;
  }

  // ---------- Neige ----------

  function lancerNeige() {
    const canevas = document.getElementById('neige');
    const contexte = canevas.getContext('2d');
    let flocons = [];
    let largeur = 0;
    let hauteur = 0;

    function redimensionner() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      largeur = window.innerWidth;
      hauteur = window.innerHeight;
      canevas.width = largeur * ratio;
      canevas.height = hauteur * ratio;
      contexte.setTransform(ratio, 0, 0, ratio, 0, 0);

      const nombre = Math.min(140, Math.round((largeur * hauteur) / 7000));
      flocons = [];
      for (let i = 0; i < nombre; i++) {
        flocons.push(nouveauFlocon(true));
      }
    }

    function nouveauFlocon(positionAleatoire) {
      const rayon = 0.6 + Math.random() * Math.random() * 2.6;
      return {
        x: Math.random() * largeur,
        y: positionAleatoire ? Math.random() * hauteur : -5,
        rayon,
        vitesse: 0.25 + rayon * 0.28,
        phase: Math.random() * Math.PI * 2,
        amplitude: 0.3 + Math.random() * 0.6,
        opacite: 0.35 + Math.random() * 0.5,
      };
    }

    function animer() {
      contexte.clearRect(0, 0, largeur, hauteur);
      for (const flocon of flocons) {
        flocon.phase += 0.012;
        flocon.y += flocon.vitesse;
        flocon.x += Math.sin(flocon.phase) * flocon.amplitude;

        if (flocon.y > hauteur + 5) {
          Object.assign(flocon, nouveauFlocon(false));
        }

        contexte.beginPath();
        contexte.arc(flocon.x, flocon.y, flocon.rayon, 0, Math.PI * 2);
        contexte.fillStyle = `rgba(255, 255, 255, ${flocon.opacite})`;
        contexte.fill();
      }
      requestAnimationFrame(animer);
    }

    redimensionner();
    window.addEventListener('resize', redimensionner);
    requestAnimationFrame(animer);
  }

  // ---------- Application installable (PWA) ----------

  const CLE_INSTALLATION_REFUSEE = 'avent:installation-refusee';
  let invitationAndroid = null; // événement fourni par Chrome, à rejouer au clic

  // Ouverte depuis l'icône de l'écran d'accueil (ou une fenêtre d'application sur ordinateur)
  function estDejaInstallee() {
    const modesApplication = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
    const ouverteCommeApplication = modesApplication.some((mode) => {
      return window.matchMedia(`(display-mode: ${mode})`).matches;
    });
    return ouverteCommeApplication || window.navigator.standalone === true;
  }

  function installationRefusee() {
    try {
      return localStorage.getItem(CLE_INSTALLATION_REFUSEE) === '1';
    } catch {
      return false;
    }
  }

  function estUnAppareilApple() {
    const agent = window.navigator.userAgent;
    const iPadRecent = agent.includes('Macintosh') && navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/.test(agent) || iPadRecent;
  }

  function preparerInstallation() {
    if (typeDePage !== 'c' || estDejaInstallee()) {
      return;
    }

    // Le service worker n'est accepté qu'en HTTPS (ou sur localhost)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/c/' }).catch(() => {});
    }

    if (installationRefusee()) {
      return;
    }

    // Android / Chrome : le navigateur propose l'installation, on la déclenche depuis notre bouton
    window.addEventListener('beforeinstallprompt', (evenement) => {
      evenement.preventDefault();
      invitationAndroid = evenement;
      afficherInvitation("Gardez le calendrier sur votre écran d'accueil.", true);
    });

    // iPhone / iPad : pas d'invitation automatique, on explique le geste
    if (estUnAppareilApple()) {
      setTimeout(() => {
        afficherInvitation("Pour l'avoir comme une appli : bouton Partager, puis « Sur l'écran d'accueil ».", false);
      }, 3000);
    }
  }

  function afficherInvitation(texte, avecBouton) {
    elements.installerTexte.textContent = texte;
    elements.installerBouton.hidden = !avecBouton;
    elements.installer.hidden = false;
  }

  function masquerInvitation() {
    elements.installer.hidden = true;
  }

  elements.installerBouton.addEventListener('click', async () => {
    if (!invitationAndroid) {
      return;
    }
    invitationAndroid.prompt();
    await invitationAndroid.userChoice;
    invitationAndroid = null;
    masquerInvitation();
  });

  elements.installerFermer.addEventListener('click', () => {
    masquerInvitation();
    try {
      localStorage.setItem(CLE_INSTALLATION_REFUSEE, '1');
    } catch {
      // stockage indisponible : l'invitation reviendra, rien de grave
    }
  });

  window.addEventListener('appinstalled', masquerInvitation);

  // ---------- Chargement des données ----------

  // numeroALaisserFerme : case qu'on s'apprête à ouvrir, pour garder l'animation de la porte
  async function chargerCalendrier(numeroALaisserFerme) {
    const reponse = await fetch(adresseApi);
    if (!reponse.ok) {
      return false;
    }
    calendrier = await reponse.json();
    casesOuvertes = lireCasesOuvertes();
    if (numeroALaisserFerme !== null) {
      casesOuvertes.delete(numeroALaisserFerme);
    }
    afficherEntete();
    construireGrille();
    return true;
  }

  // ---------- Démarrage ----------

  async function demarrer() {
    dessinerGuirlande();
    let minuterieRedimension = null;
    window.addEventListener('resize', () => {
      clearTimeout(minuterieRedimension);
      minuterieRedimension = setTimeout(dessinerGuirlande, 200);
    });

    if (!mouvementReduit) {
      lancerNeige();
    }

    const charge = await chargerCalendrier(null);
    if (!charge) {
      elements.titre.textContent = 'Oh oh oh...';
      elements.introuvable.hidden = false;
      return;
    }
    setTimeout(faireDefilerVersLaCaseDuJour, 900);
    preparerInstallation();
  }

  demarrer();
})();
