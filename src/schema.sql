-- Schéma de la base, rejoué à chaque démarrage (idempotent).

CREATE TABLE IF NOT EXISTS admins (
  id                 uuid PRIMARY KEY,
  identifiant        text NOT NULL UNIQUE,
  empreinte_mdp      text NOT NULL,
  est_super_admin    boolean NOT NULL DEFAULT false,
  cree_le            timestamptz NOT NULL DEFAULT now()
);

-- Chaque calendrier appartient à un seul admin : c'est la base de l'isolation.
CREATE TABLE IF NOT EXISTS calendriers (
  id          uuid PRIMARY KEY,
  admin_id    uuid NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  titre       text NOT NULL,
  message     text NOT NULL DEFAULT '',
  annee       integer NOT NULL,
  mode_test   boolean NOT NULL DEFAULT false,
  cree_le     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendriers_admin_idx ON calendriers (admin_id);

CREATE TABLE IF NOT EXISTS jours (
  calendrier_id  uuid NOT NULL REFERENCES calendriers (id) ON DELETE CASCADE,
  numero         integer NOT NULL CHECK (numero BETWEEN 1 AND 24),
  texte          text NOT NULL DEFAULT '',
  image          text,
  PRIMARY KEY (calendrier_id, numero)
);

-- Liens d'accès : un par destinataire, chacun avec son jeton secret.
CREATE TABLE IF NOT EXISTS liens (
  id               uuid PRIMARY KEY,
  calendrier_id    uuid NOT NULL REFERENCES calendriers (id) ON DELETE CASCADE,
  nom              text NOT NULL,
  jeton            text NOT NULL UNIQUE,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  derniere_visite  timestamptz
);

CREATE INDEX IF NOT EXISTS liens_calendrier_idx ON liens (calendrier_id);

-- Cases déjà ouvertes par chaque destinataire (suit le lien, pas le navigateur).
CREATE TABLE IF NOT EXISTS ouvertures (
  lien_id     uuid NOT NULL REFERENCES liens (id) ON DELETE CASCADE,
  numero      integer NOT NULL CHECK (numero BETWEEN 1 AND 24),
  ouverte_le  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lien_id, numero)
);
