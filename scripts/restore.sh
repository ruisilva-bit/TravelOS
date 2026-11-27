#!/usr/bin/env bash
# Restore a TravelOS dump into a NEW database and print key row counts to compare.
# Usage: scripts/restore.sh <dump-file> <target-db-name> [--replace]
# Without --replace, an existing target database is never touched.
# Connects with the usual PG* variables (needs CREATEDB; e.g. run as the postgres user).
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 <dump-file> <target-db-name> [--replace]" >&2
  exit 2
fi
DUMP="$1"
TARGET="$2"
REPLACE="${3:-}"

[[ -f "${DUMP}" ]] || { echo "Dump not found: ${DUMP}" >&2; exit 1; }
[[ "${TARGET}" =~ ^[a-z][a-z0-9_]{2,62}$ ]] || { echo "Bad database name: ${TARGET}" >&2; exit 2; }
[[ -z "${REPLACE}" || "${REPLACE}" == "--replace" ]] || { echo "Unknown option: ${REPLACE}" >&2; exit 2; }

EXISTS="$(psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '${TARGET}'")"
if [[ -n "${EXISTS}" ]]; then
  if [[ "${REPLACE}" != "--replace" ]]; then
    echo "Database ${TARGET} already exists. Use a new name, or pass --replace to drop it." >&2
    exit 1
  fi
  echo "Dropping existing database ${TARGET}"
  dropdb "${TARGET}"
fi

createdb "${TARGET}"
# --no-owner: the target may not have the travelos_* roles; ownership is not needed to inspect data.
pg_restore --no-owner --dbname "${TARGET}" "${DUMP}"

echo "Row counts in ${TARGET} (compare with the live database):"
for table in crm.customer trip_ops.trip staff_access.staff_membership; do
  printf '%-28s %s\n' "${table}" "$(psql -d "${TARGET}" -Atc "SELECT count(*) FROM ${table}")"
done
