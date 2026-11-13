# Calendrier de l'Avent

Petite application Node.js pour créer des calendriers de l'Avent personnalisés.

- **Backoffice** (`/admin/`) : créer plusieurs calendriers, remplir chacune des 24 cases avec un texte, une image, ou les deux.
- **Page publique** (`/c/<adresse>`) : pensée pour le mobile. Une case s'ouvre à partir du jour correspondant, d'après la **date système du serveur**. Le contenu des cases futures n'est jamais envoyé au navigateur.

## Démarrage

```bash
npm install
cp .env.example .env   # puis définir ADMIN_PASSWORD et SESSION_SECRET
npm start
```

Puis ouvrir `http://localhost:3000/admin/`.

## Configuration (`.env`)

| Variable         | Rôle                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `PORT`           | Port d'écoute (3000 par défaut)                                      |
| `ADMIN_PASSWORD` | Mot de passe du backoffice (obligatoire)                             |
| `SESSION_SECRET` | Secret des cookies de session                                        |
| `DATE_SIMULEE`   | Pour tester : force la date du jour (`AAAA-MM-JJ`). Vide en prod.   |
| `TZ`             | Fuseau horaire du serveur si besoin (ex. `Europe/Paris`)             |

## Fonctionnement

- Avant le 1er décembre : toutes les cases sont fermées, la page affiche un compte à rebours.
- Du 1er au 24 décembre : les cases jusqu'au jour courant s'ouvrent, celle du jour est mise en avant.
- À partir du 25 décembre : toutes les cases sont ouvertes.
- Les cases déjà ouvertes sont mémorisées dans le navigateur du visiteur.
- Le lien « Aperçu complet » du backoffice (`?apercu=1`) ouvre toutes les cases, uniquement pour un admin connecté.
- La coche **Test date** (réglages d'un calendrier) fait sauter les verrous de date pour **tous les visiteurs** de ce calendrier. Les ouvertures ne sont alors pas mémorisées, les portes seront donc bien refermées une fois la coche retirée. Un badge « test date » le signale dans la liste.

## Données

Tout est stocké dans `data/` (ignoré par git) :

- `data/calendriers.json` : les calendriers et leurs cases
- `data/uploads/` : les images (noms aléatoires, réduites à 1600 px côté navigateur avant envoi)

Sauvegarder ce dossier suffit pour tout conserver.
