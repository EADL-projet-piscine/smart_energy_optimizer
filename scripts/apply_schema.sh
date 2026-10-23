#!/bin/sh
# Applique le schéma et les rôles sur une base déjà initialisée.
# Le premier démarrage d'un volume vide le fait seul (db/init).
set -eu

cd "$(git rev-parse --show-toplevel)"

docker compose exec -T db sh /docker-entrypoint-initdb.d/01_schema.sh
docker compose exec -T db sh /docker-entrypoint-initdb.d/02_roles.sh
docker compose exec -T db \
  psql -v ON_ERROR_STOP=1 --username enervision --dbname enervision \
  -f /docker-entrypoint-initdb.d/03_grants.sql

echo "Schéma et rôles appliqués."
