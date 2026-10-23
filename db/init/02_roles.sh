#!/bin/sh
# Rôles de connexion. Les mots de passe viennent de l'environnement du conteneur,
# pas du dépôt : APP_DB_PASSWORD (application) et ML_DB_PASSWORD (traitements).
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD manquant}"
: "${ML_DB_PASSWORD:?ML_DB_PASSWORD manquant}"
: "${POSTGRES_USER:?POSTGRES_USER manquant}"
: "${POSTGRES_DB:?POSTGRES_DB manquant}"

psql_cmd() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"
}

ensure_role() {
  role=$1
  password=$2
  exists=$(psql_cmd -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$role'" | tr -d '[:space:]')
  # psql ne substitue pas les variables dans -c : le SQL passe par l'entrée standard.
  if [ "$exists" = "1" ]; then
    sql="ALTER ROLE $role WITH LOGIN PASSWORD :'pw';"
  else
    sql="CREATE ROLE $role LOGIN PASSWORD :'pw';"
  fi
  printf '%s\n' "$sql" | psql_cmd -v pw="$password" -f -
}

ensure_role enervision_app "$APP_DB_PASSWORD"
ensure_role enervision_ml "$ML_DB_PASSWORD"
