# Calendrier de l'Avent

Petite application Node.js + PostgreSQL pour créer des calendriers de l'Avent personnalisés.

- **Backoffice** (`/admin/`) : chaque admin a son compte et ne voit que **ses** calendriers. Il remplit les 24 cases (texte, image, ou les deux) et génère un **lien secret par destinataire**.
- **Page publique** (`/c/<jeton>`) : pensée pour le mobile. On n'y accède qu'avec un lien généré par l'admin. Une case s'ouvre à partir du jour correspondant, d'après la **date système du serveur**. Le contenu des cases futures n'est jamais envoyé au navigateur.

## Avec Docker (recommandé)

```bash
cp .env.example .env   # puis définir POSTGRES_PASSWORD, ADMIN_PASSWORD et SESSION_SECRET
docker compose up -d --build
```

- Deux conteneurs : `db` (PostgreSQL 17) et `calendrier` (l'application, port 3000, utilisateur `node`).
- L'application attend que la base soit prête avant de démarrer.
- Données : volume `base` pour PostgreSQL, volume `donnees` (`/app/data`) pour les images. `docker compose down -v` efface tout.
- Le fuseau horaire est fixé à `Europe/Paris` : c'est lui qui décide à quelle heure la case du jour s'ouvre.
- Mise à jour après un `git pull` : `docker compose up -d --build`.

## HTTPS public (hébergement à la maison)

Il faut un nom de domaine qui pointe vers l'IP publique, et les ports 80 et 443 de la box redirigés vers la machine.

```bash
# dans .env : DOMAINE=monnom.freeboxos.fr et TRUST_PROXY=1
docker compose --profile https up -d --build
docker compose logs -f caddy      # suivre l'obtention du certificat
```

Caddy obtient et renouvelle seul le certificat Let's Encrypt. Le port 3000 de l'application n'est publié que sur `127.0.0.1` : depuis Internet, tout passe par Caddy.

## Sans Docker pour l'application

La base tourne quand même dans Docker, l'application en local :

```bash
npm install
cp .env.example .env          # DATABASE_URL pointe sur localhost:5432
docker compose up -d db       # PostgreSQL seul, exposé sur 127.0.0.1:5432
npm start
```

## Comptes admin

- Au **premier démarrage**, si la base ne contient aucun compte, un super admin est créé avec `ADMIN_LOGIN` / `ADMIN_PASSWORD`. Ensuite ces deux variables ne servent plus.
- Le **super admin** gère les comptes (menu « Comptes ») : création avec un mot de passe provisoire, nouveau mot de passe, suppression. Supprimer un compte supprime aussi ses calendriers et leurs images.
- Chaque admin change son mot de passe dans « Mon compte » (10 caractères minimum).
- **Isolation** : toutes les requêtes du backoffice sont filtrées sur le compte connecté. Personne, super admin compris, ne peut lire, modifier ou prévisualiser le calendrier d'un autre.
- Après 5 mots de passe faux sur un identifiant, celui-ci est bloqué 10 minutes.
- Mots de passe hachés avec scrypt. Sessions stockées en base (table `sessions`) : elles survivent aux redémarrages.

## Liens d'accès

- Dans l'édition d'un calendrier, « Générer un lien » crée un lien nominatif (ex. « Léa ») du type `https://votre-site/c/Xk3...` avec un jeton aléatoire de 32 caractères. Le lien est copié automatiquement.
- Un calendrier peut avoir autant de liens que de destinataires. Supprimer un lien le désactive aussitôt, sans toucher aux autres.
- La date de dernière visite et le nombre de cases ouvertes de chaque lien sont affichés. Le backoffice n'a volontairement pas de bouton pour ouvrir le lien d'un destinataire : cela fausserait ce suivi. Pour vérifier le rendu, utiliser « Aperçu complet ».
- Envoyé dans une messagerie, le lien s'affiche avec un titre et une image d'aperçu (`public/img/partage.png`).
- Sans lien valide, la page affiche « calendrier introuvable ».
- Les pages envoient `Referrer-Policy: no-referrer` et `noindex` : les jetons ne fuient pas vers d'autres sites ni dans les moteurs de recherche.

## Configuration (`.env`)

| Variable            | Rôle                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `PORT`              | Port d'écoute (3000 par défaut)                                             |
| `POSTGRES_PASSWORD` | Mot de passe de la base (lettres et chiffres, il est repris dans une URL)  |
| `DATABASE_URL`      | Adresse de la base pour `npm start` (remplacée automatiquement dans Docker) |
| `ADMIN_LOGIN`       | Identifiant du premier super admin (`admin` par défaut)                     |
| `ADMIN_PASSWORD`    | Mot de passe du premier super admin                                         |
| `SESSION_SECRET`    | Secret des cookies de session                                               |
| `DATE_SIMULEE`      | Pour tester : force la date du jour (`AAAA-MM-JJ`). Vide en prod.          |
| `TRUST_PROXY`       | `1` si le site est servi en HTTPS derrière un proxy ou un tunnel            |
| `DOMAINE`           | Nom de domaine public servi en HTTPS par Caddy (profil `https`)             |
| `TZ`                | Fuseau horaire du serveur si besoin (ex. `Europe/Paris`)                    |

## Fonctionnement

- Avant le 1er décembre : toutes les cases sont fermées, la page affiche un compte à rebours.
- Du 1er au 24 décembre : les cases jusqu'au jour courant s'ouvrent, celle du jour est mise en avant.
- À partir du 25 décembre : toutes les cases sont ouvertes.
- Passage de minuit : pas besoin de recharger la page. Un clic sur la prochaine case fermée interroge le serveur, qui décide avec sa propre date.
- Les cases déjà ouvertes sont enregistrées en base, **par lien** : le destinataire les retrouve sur n'importe quel appareil, et le backoffice affiche combien de cases chaque lien a ouvertes. Changer l'année d'un calendrier referme toutes ses cases.
- « Aperçu complet » (`/apercu/<id>`) ouvre toutes les cases, uniquement pour l'admin propriétaire connecté.
- La coche **Test date** (réglages d'un calendrier) fait sauter les verrous de date pour **tous les liens** de ce calendrier. Les ouvertures ne sont alors pas mémorisées. Un badge « test date » le signale dans la liste.

## Données

- PostgreSQL : tables `admins`, `calendriers`, `jours`, `liens`, `ouvertures`, `sessions` (schéma dans `src/schema.sql`, appliqué au démarrage).
- `data/uploads/` : les images (noms aléatoires, réduites à 1600 px côté navigateur avant envoi).

Sauvegarde : `docker compose exec db pg_dump -U calendrier calendrier > sauvegarde.sql`, plus le volume `donnees`.
