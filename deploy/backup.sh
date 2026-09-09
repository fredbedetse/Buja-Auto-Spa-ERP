#!/usr/bin/env bash
# Nightly Postgres backup. Cron example (02:30 daily):
#   30 2 * * * /srv/buja-erp/deploy/backup.sh >> /var/log/buja-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP="${KEEP:-14}"
DIR="$(dirname "$0")/backups"
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="$DIR/bujaerp-$STAMP.sql.gz"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-buja}" -d "${POSTGRES_DB:-bujaerp}" | gzip > "$FILE"
# sidecar sha so restores can verify integrity
( cd "$DIR" && sha256sum "bujaerp-$STAMP.sql.gz" > "bujaerp-$STAMP.sha256" )
ls -1t "$DIR"/*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$DIR"/*.sha256 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
echo "!! copy off-box: this volume lives and dies with the server"
