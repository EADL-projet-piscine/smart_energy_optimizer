#!/bin/sh
# Applique, dans l'ordre des noms de fichiers, les migrations SQL qui ne l'ont pas encore
# été, et note chacune dans schema_migrations.
#
# Un seul script pour deux usages :
# - à la création de la base, lancé par l'image PostgreSQL (docker-entrypoint-initdb.d) ;
# - à chaque déploiement (deploy.yml), sur la base existante : seules les nouvelles
#   migrations s'appliquent. Une migration notée n'est jamais rejouée, ce qui permet des
#   migrations qui ne sont pas idempotentes (ADD CONSTRAINT, DROP COLUMN…).
set -eu

: "${POSTGRES_USER:?POSTGRES_USER manquant}"
: "${POSTGRES_DB:?POSTGRES_DB manquant}"

files=$(find /migrations -maxdepth 1 -type f -name '*.sql' | sort)
if [ -z "$files" ]; then
  echo "Aucune migration dans /migrations." >&2
  exit 1
fi

psql_cmd() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"
}

psql_cmd -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE schema_migrations IS
  'Migrations de db/migrations déjà appliquées, notées par db/init/01_schema.sh.';
SQL

# Amorçage : une base créée avant ce suivi a reçu des migrations sans les noter. On les
# reconnaît à ce qu'elles ont créé, une seule fois : les suivantes sont toujours notées.
# Sur une base neuve, aucune n'est reconnue et toutes s'appliquent.
if [ "$(psql_cmd -Atc 'SELECT count(*) FROM schema_migrations')" = 0 ]; then
  psql_cmd -q <<'SQL'
INSERT INTO schema_migrations (version)
SELECT version FROM (VALUES
  ('001_initial_schema.sql', to_regclass('public.sites') IS NOT NULL),
  ('002_forecast_origin.sql', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'predictions'
      AND column_name = 'forecast_origin')),
  ('003_recommendations.sql', to_regclass('public.recommendations') IS NOT NULL)
) AS known (version, applied)
WHERE applied;
SQL
fi

applied=0
for file in $files; do
  version=$(basename "$file")
  # psql ne substitue pas les variables dans -c : la requête passe par l'entrée standard.
  if [ -n "$(echo "SELECT 1 FROM schema_migrations WHERE version = :'v';" | psql_cmd -At -v v="$version" -f -)" ]; then
    continue
  fi
  echo "Application de $version"
  # Chaque migration porte sa propre transaction (BEGIN … COMMIT) : en cas d'erreur, elle
  # n'est ni appliquée ni notée, et le script s'arrête.
  psql_cmd -q -f "$file"
  echo "INSERT INTO schema_migrations (version) VALUES (:'v');" | psql_cmd -q -v v="$version" -f -
  applied=$((applied + 1))
done
echo "Migrations appliquées : $applied."
