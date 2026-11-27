#!/usr/bin/env bash
# TravelOS nightly backup: pg_dump -Fc of the database, keep 14 days, optional off-box copy.
# Runs as the `travelos` user via travelos-backup.timer (reads /etc/travelos/backup.env).
# Env: PGDATABASE (default travelos_prod), PGUSER, PGHOST, PGPASSFILE for the dump user,
#      TRAVELOS_BACKUP_DIR (default /var/backups/travelos),
#      TRAVELOS_BACKUP_COPY_TO (optional rsync target, e.g. backup@nas:/volume/travelos/)
set -euo pipefail

DB="${PGDATABASE:-travelos_prod}"
DIR="${TRAVELOS_BACKUP_DIR:-/var/backups/travelos}"
STAMP="$(date +%Y%m%d-%H%M)"
FILE="${DIR}/travelos-${STAMP}.dump"

mkdir -p "${DIR}"
echo "Dumping ${DB} to ${FILE}"
# Write to a temp name first so a half-written dump is never mistaken for a good one.
pg_dump -Fc --dbname "${DB}" --file "${FILE}.partial"
mv "${FILE}.partial" "${FILE}"

echo "Removing dumps older than 14 days"
find "${DIR}" -maxdepth 1 -name 'travelos-*.dump' -mtime +14 -delete
find "${DIR}" -maxdepth 1 -name '*.partial' -mtime +1 -delete

if [[ -n "${TRAVELOS_BACKUP_COPY_TO:-}" ]]; then
  echo "Copying to ${TRAVELOS_BACKUP_COPY_TO}"
  rsync -a "${FILE}" "${TRAVELOS_BACKUP_COPY_TO}"
else
  echo "WARNING: TRAVELOS_BACKUP_COPY_TO is not set; backup exists only on this machine." >&2
fi
echo "Backup OK: ${FILE}"
