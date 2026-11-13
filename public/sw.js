// Service worker volontairement minimal : il rend le calendrier installable
// et affiche une page d'excuse quand le téléphone n'a pas de connexion.
// Il n'utilise aucun cache : le contenu des cases vient toujours du serveur,
// et la page hors connexion est écrite ici, donc rien ne peut manquer.

const PAGE_HORS_LIGNE = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0c2024">
  <title>Pas de connexion</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      box-sizing: border-box;
      background: radial-gradient(circle at 50% 30%, #163a40, #0c2024 70%);
      color: #f4ead6;
      font-family: Georgia, serif;
      text-align: center;
    }
    h1 { margin: 0 0 12px; font-size: 1.6rem; color: #e2bd6b; }
    p { margin: 0 0 22px; line-height: 1.5; opacity: 0.9; }
    button {
      padding: 12px 22px;
      border: 0;
      border-radius: 999px;
      background: #e2bd6b;
      color: #2d211a;
      font: inherit;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <h1>Le traîneau est coincé dans la neige</h1>
    <p>Pas de connexion pour l'instant.<br>Vos cases vous attendent, réessayez dans un moment.</p>
    <button type="button" onclick="location.reload()">Réessayer</button>
  </main>
</body>
</html>`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(self.clients.claim());
});

function reponseHorsLigne() {
  return new Response(PAGE_HORS_LIGNE, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

self.addEventListener('fetch', (evenement) => {
  // Seules les ouvertures de page sont concernées, pas les appels à l'API ni les images
  if (evenement.request.mode !== 'navigate') {
    return;
  }
  evenement.respondWith(fetch(evenement.request).catch(reponseHorsLigne));
});
