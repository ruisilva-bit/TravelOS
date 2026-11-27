#!/usr/bin/env bash
# TravelOS deploy: run on CT200 as the `travelos` user, from the git checkout (/srv/travelos).
# Usage: scripts/deploy.sh [git-ref]      (default: origin/main)
# Steps: fetch code -> toolchain -> install -> build -> migrate -> restart -> health check.
set -euo pipefail

REF="${1:-origin/main}"
TOOLCHAIN_ROOT="${TRAVELOS_TOOLCHAIN_ROOT:-/srv/travelos-toolchain}"
MANIFEST="${TRAVELOS_MANIFEST:-/etc/travelos/travelos.json}"
# Database settings for the migration user (see docs/DEPLOYMENT_MODEL.md).
MIGRATE_ENV="${TRAVELOS_MIGRATE_ENV:-/etc/travelos/migrate.env}"
NODE_BIN="${TOOLCHAIN_ROOT}/node-v24.19.0-linux-x64/bin"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> Fetching ${REF}"
git fetch --prune origin
git checkout --detach "${REF}"

echo "==> Preparing the pinned Node/pnpm toolchain"
bash tooling/ci/bootstrap-toolchain.sh "${TOOLCHAIN_ROOT}"
export PATH="${NODE_BIN}:${PATH}"

echo "==> Installing dependencies and building"
bash tooling/ci/install.sh
pnpm build

echo "==> Applying database migrations"
set -a
# shellcheck disable=SC1090
source "${MIGRATE_ENV}"
set +a
pnpm db:migrate

echo "==> Restarting services"
sudo systemctl restart travelos-api travelos-worker

# Read the admin host and port from the same manifest the services use.
read -r ADMIN_HOST ADMIN_PORT < <(node -e '
  const m = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  const l = m.runtime.listeners.adminApi;
  console.log(m.hosts.admin, l.port);' "${MANIFEST}")

echo "==> Waiting up to 30 s for http://127.0.0.1:${ADMIN_PORT}/health/live"
for _ in $(seq 1 30); do
  # The API only answers requests whose Host header matches the manifest.
  if curl --fail --silent --output /dev/null -H "Host: ${ADMIN_HOST}" \
    "http://127.0.0.1:${ADMIN_PORT}/health/live"; then
    echo "Deploy OK: $(git rev-parse --short HEAD) is live."
    exit 0
  fi
  sleep 1
done

echo "DEPLOY FAILED: API did not become healthy within 30 s." >&2
echo "Look at: journalctl -u travelos-api -u travelos-worker -n 100 --no-pager" >&2
exit 1
