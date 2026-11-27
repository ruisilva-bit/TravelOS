#!/usr/bin/env bash
set -euo pipefail

readonly NODE_VERSION=24.19.0
readonly NODE_ARCHIVE=node-v${NODE_VERSION}-linux-x64.tar.xz
readonly NODE_SHA256=14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647
readonly TOOLCHAIN_ROOT=${1:-${RUNNER_TEMP:-/tmp}/travelos-toolchain}
readonly NODE_ROOT=${TOOLCHAIN_ROOT}/node-v${NODE_VERSION}-linux-x64

mkdir -p "${TOOLCHAIN_ROOT}"
if [[ ! -x "${NODE_ROOT}/bin/node" ]]; then
  curl --fail --silent --show-error --location \
    --output "${TOOLCHAIN_ROOT}/${NODE_ARCHIVE}" \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"
  printf '%s  %s\n' "${NODE_SHA256}" "${TOOLCHAIN_ROOT}/${NODE_ARCHIVE}" | sha256sum --check --status
  tar -xJf "${TOOLCHAIN_ROOT}/${NODE_ARCHIVE}" -C "${TOOLCHAIN_ROOT}"
fi

# corepack's shebang needs node on PATH.
export PATH="${NODE_ROOT}/bin:${PATH}"
"${NODE_ROOT}/bin/corepack" enable --install-directory "${NODE_ROOT}/bin"
"${NODE_ROOT}/bin/corepack" prepare pnpm@11.21.0 --activate

if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "${NODE_ROOT}/bin" >> "${GITHUB_PATH}"
fi
printf 'TravelOS toolchain ready at %s\n' "${NODE_ROOT}/bin"
printf 'For this shell: export PATH=%s/bin:$PATH\n' "${NODE_ROOT}"
