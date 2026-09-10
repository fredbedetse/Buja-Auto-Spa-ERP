#!/usr/bin/env bash
# Restore a backup: deploy/restore.sh deploy/backups/bujaerp-20260910-023000.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?usage: restore.sh <path.sql.gz>}"
[ -f "$FILE" ] || { echo "no such file: $FILE"; exit 1; }
SHA="${FILE%.sql.gz}.sha256"
if [ -f "$SHA" ]; then ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$SHA")" ) || { echo "checksum mismatch - refusing"; exit 1; }; fi
read -p "This OVERWRITES the live database. Type YES to continue: " ok
[ "$ok" = "YES" ] || { echo "aborted"; exit 1; }
docker compose stop api
gunzip -c "$FILE" | docker compose exec -T db psql -U "${POSTGRES_USER:-buja}" -d "${POSTGRES_DB:-bujaerp}" -v ON_ERROR_STOP=1
docker compose start api
echo "restored: $FILE"
