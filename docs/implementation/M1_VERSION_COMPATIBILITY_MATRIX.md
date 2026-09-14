# M1 Stage 1 — Version Compatibility Matrix

**Status:** Frozen-candidate input for independent Stage 1 review  
**Qualified:** 2026-08-14  
**Probe location:** disposable and removed after evidence capture; never CT 200 or product source

## 1. Selection policy

- Use exact versions and a committed pnpm lockfile; mutable ranges are forbidden in the bootstrap candidate.
- Resolve with Node `24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`, `engineStrict: true`, `--strict-peer-dependencies`, and a clean install with no stale lockfile.
- Permit dependency install scripts only through an explicit pnpm allowlist; Stage 1 allowed only `esbuild`.
- Apply a minimum-release-age supply-chain gate. Better Auth `1.6.28` was too new at qualification time and was rejected; runtime and CLI remain aligned at `1.6.27`.
- Production and complete dependency graphs must audit with zero known vulnerabilities at freeze time.
- `vite-tsconfig-paths` is rejected and absent. It is unnecessary when aliases are owned explicitly and its candidate graph did not satisfy the strict TypeScript compatibility gate.

## 2. Runtime, package manager and deployment tools

| Component | Exact qualification pin | Evidence/decision |
|---|---:|---|
| Node.js | `24.19.0` | Official Linux x64 archive executed; SHA-256 matched `SHASUMS256.txt` |
| npm bundled with Node | `11.17.0` | Informational only; pnpm is the project package manager |
| Corepack | `0.35.0` | Used to invoke the exact pnpm toolchain |
| pnpm | `11.21.0` | Clean strict and frozen installs passed |
| PostgreSQL | major `18`; tested `18.6` (`18.6-1.pgdg13+2`) | Server, client, migration, dump/restore probe passed |
| pgBackRest | `2.59.0` (`2.59.0-1.pgdg13+1`) | Official PGDG package checksum and executable load passed |
| Caddy | `2.11.4` | Official Linux amd64 release checksum and `caddy version` passed; no CT install |
| Syft | `1.51.0` | Official Linux amd64 checksum and `syft version` passed; CI/SBOM tooling |
| Cosign | `3.1.3` | Official Linux amd64 checksum and `cosign version` passed; CI signing tooling |

Node archive official SHA-256:

```text
14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647  node-v24.19.0-linux-x64.tar.xz
```

Release-tool official checksums:

```text
4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71  cosign-linux-amd64
2a2e837a2c8d59ec9af5472ee22d3b04ee463c4e44476ecf993fd1e5ab6ebc7f  syft_1.51.0_linux_amd64.tar.gz
8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9  caddy_2.11.4_linux_amd64.tar.gz  # SHA-512
```

## 3. Complete direct JavaScript dependency matrix

### Application/runtime dependencies

| Package | Exact version | Purpose |
|---|---:|---|
| `@nestjs/common` | `11.1.29` | Nest application framework |
| `@nestjs/core` | `11.1.29` | Nest application framework |
| `@nestjs/platform-express` | `11.1.29` | Initial HTTP adapter |
| `@asteasolutions/zod-to-openapi` | `9.1.0` | Generate explicit OpenAPI from owned Zod contracts |
| `better-auth` | `1.6.27` | Staff/Portal authentication runtime |
| `decimal.js` | `10.6.0` | Exact decimal arithmetic/rates |
| `kysely` | `0.29.5` | Typed SQL adapter |
| `nestjs-pino` | `4.6.1` | Nest logging adapter |
| `pg` | `8.23.0` | PostgreSQL driver |
| `pino` | `10.3.1` | Structured application logging |
| `pino-http` | `11.0.0` | HTTP logging adapter |
| `react` | `19.2.8` | Admin/Portal UI |
| `react-dom` | `19.2.8` | Admin/Portal UI |
| `reflect-metadata` | `0.2.2` | Nest metadata runtime |
| `rxjs` | `7.8.2` | Nest runtime dependency |
| `zod` | `4.4.3` | Explicit trust-boundary contracts |

### Development, test and authoring dependencies

| Package | Exact version | Purpose |
|---|---:|---|
| `@axe-core/playwright` | `4.13.0` | Accessibility assertions |
| `@eslint/js` | `10.0.1` | ESLint core flat configuration |
| `@nestjs/testing` | `11.1.29` | Nest tests |
| `@playwright/test` | `1.62.1` | Browser acceptance/security tests |
| `@tailwindcss/vite` | `4.3.3` | Vite Tailwind integration |
| `@testing-library/dom` | `10.4.1` | DOM test queries |
| `@testing-library/jest-dom` | `7.0.1` | DOM assertions |
| `@testing-library/react` | `16.3.2` | React component tests |
| `@types/node` | `24.13.3` | Node typings aligned to major 24 |
| `@types/pg` | `8.21.0` | PostgreSQL driver typings |
| `@types/react` | `19.2.18` | React typings |
| `@types/react-dom` | `19.2.4` | React DOM typings |
| `@types/supertest` | `7.2.1` | HTTP test typings |
| `@vitejs/plugin-react` | `6.0.5` | React/Vite compiler integration |
| `@vitest/coverage-v8` | `4.1.10` | Unit-test coverage |
| `auth` | `1.6.27` | Better Auth schema-authoring CLI only |
| `dependency-cruiser` | `18.2.0` | Architecture boundary enforcement |
| `eslint` | `10.8.1` | Static analysis |
| `eslint-plugin-boundaries` | `7.2.0` | Package-layer boundary rules |
| `fast-check` | `4.9.0` | Property-based invariant tests |
| `jsdom` | `30.0.1` | DOM unit-test environment |
| `node-pg-migrate` | `9.0.0` | Single owned migration chain |
| `prettier` | `3.9.6` | Formatting |
| `supertest` | `7.2.2` | Nest HTTP tests |
| `tailwindcss` | `4.3.3` | Owned design-system styling |
| `tsx` | `4.23.12` | Development/probe TypeScript execution |
| `typescript` | `6.0.3` | Language/compiler |
| `typescript-eslint` | `8.67.0` | ESLint flat-config integration |
| `vite` | `8.2.1` | Admin/Portal production builds |
| `vitest` | `4.1.10` | Unit/property tests |

TypeScript `7.0.2` was not selected because the qualified `typescript-eslint@8.67.0` peer range is `<6.1.0`; `6.0.3` is the highest candidate that passed the complete strict peer graph.

## 4. Required transitive resolution

The Better Auth CLI chain originally resolved a vulnerable `lodash@4.17.21` through `auth → @mrleebo/prisma-ast → chevrotain`. The frozen candidate contains this tested workspace override:

```yaml
overrides:
  lodash: 4.18.1
```

The pnpm override deliberately replaces Chevrotain's transitive `lodash@4.17.21` pin with `lodash@4.18.1`. The clean/frozen installs passed, Better Auth generated byte-identical Staff and Portal SQL, and both full and production `pnpm audit` reports returned zero vulnerabilities. The override is part of the pin contract and must not be removed without a fresh CLI generation/audit probe.

## 5. Compatibility evidence

| Gate | Result |
|---|---|
| Clean install, no lockfile/node_modules | PASS |
| `engineStrict: true` | PASS |
| `--strict-peer-dependencies` | PASS |
| Frozen reinstall | PASS |
| Complete resolved graph export | PASS |
| Production audit | PASS — 0 critical/high/moderate/low |
| Full audit including CLI tooling | PASS — 0 critical/high/moderate/low |
| Strict owned TypeScript checks | PASS |
| Nest compile and process smoke | PASS |
| React/Vite/Tailwind production build | PASS |
| ESLint | PASS |
| dependency-cruiser | PASS — 20 modules, 0 violations |
| Vitest | PASS — 1 file, 3 tests |
| Better Auth CLI version/generation | PASS — `auth@1.6.27` |
| PostgreSQL startup/connectivity | PASS — `18.6`, checksums enabled |
| `pg` + Kysely | PASS — server `180006`, exact numeric result `0.3` |
| `node-pg-migrate` up/down | PASS — ledger 1 → 0 and table removed |
| `pg_dump`/`pg_restore` | PASS — restored table sets matched |
| pgBackRest executable compatibility | PASS |
| Caddy/Syft/Cosign executable compatibility | PASS |

Better Auth publishes optional Bun, Cloudflare and browser declaration paths that do not all typecheck in a pure Node composition root. The candidate therefore uses `skipLibCheck: true` only for third-party declarations while keeping TravelOS-owned code under strict type checking. Stage 2 must not weaken owned-code strictness.

## 6. Probe artifact hashes

```text
b434341ef06fd313ae9d5375007014162955e949f21f27ce00691ad54ee6d10c  package.json
483de2bb70b5a6a037952a68afc1abdb17baec57d98e04b222a17fbbf9880661  pnpm-workspace.yaml
0e78837f65a1bbd7a8c6490533950bfc8a16d0f05993e34184ae71f0ad33b2f5  pnpm-lock.yaml
f65a85654e3d21f0ab1f9361757f6198639166fde9794194e93d0fb225531e6f  generated/staff.sql
ce2562b3d8ff1fcc2282be1c1977de54d228265ad7f2107c4c54ac6a5f194762  generated/portal.sql
d1e68649e0554c713caab1670bf31ffe6311fe4b2e6ac8b6c7fd91b85e8dbde0  probe.dump
```

The SQL and dump are evidence only. They are not product migrations and were removed with the disposable probe.

## 7. Authoritative source ledger

- Node release/index/checksums: `https://nodejs.org/dist/`, `https://nodejs.org/dist/v24.19.0/`
- npm package manifests/timestamps/tarball integrity: `https://registry.npmjs.org/<package>`
- Better Auth repository package manifests and CLI source: `https://github.com/better-auth/better-auth`
- Better Auth CLI documentation: `https://www.better-auth.com/docs/concepts/cli`
- PostgreSQL version policy: `https://www.postgresql.org/support/versioning/`
- PostgreSQL downloads/PGDG: `https://www.postgresql.org/download/linux/debian/`, `https://apt.postgresql.org/`
- Caddy release: `https://github.com/caddyserver/caddy/releases/tag/v2.11.4`
- Syft release: `https://github.com/anchore/syft/releases/tag/v1.51.0`
- Cosign release: `https://github.com/sigstore/cosign/releases/tag/v3.1.3`

## 8. Upgrade rule

An exact pin may change only through a fresh compatibility candidate that repeats the affected engine/peer, build, architecture, auth schema, security-audit, PostgreSQL migration and backup/restore gates. PostgreSQL remains pinned by major in the deployment contract and by exact package/artifact in each release manifest. Better Auth runtime and CLI must move together.
