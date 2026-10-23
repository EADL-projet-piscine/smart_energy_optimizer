#!/bin/sh
# Applique les migrations SQL dans l'ordre des noms de fichiers.
set -eu

: "${POSTGRES_USER:?POSTGRES_USER manquant}"
: "${POSTGRES_DB:?POSTGRES_DB manquant}"

files=$(find /migrations -maxdepth 1 -type f -name '*.sql' | sort)
if [ -z "$files" ]; then
  echo "Aucune migration dans /migrations." >&2
  exit 1
fi

for file in $files; do
  echo "Application de $file"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$file"
done
