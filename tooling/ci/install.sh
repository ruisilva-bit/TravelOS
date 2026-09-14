#!/usr/bin/env bash
set -euo pipefail

[[ "$(node --version)" == "v24.19.0" ]]
[[ "$(corepack --version)" == "0.35.0" ]]
[[ "$(pnpm --version)" == "11.21.0" ]]
pnpm install --frozen-lockfile --strict-peer-dependencies "${@}"
