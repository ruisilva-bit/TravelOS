# M1 Stage 1 — Bootstrap Decisions — Corrected Candidate

**Status:** post-review corrected-generation candidate  
**Supersedes:** `M1_BOOTSTRAP_DECISIONS.md` only after focused independent closure  
**Scope:** documentary bootstrap decisions only; no Stage 2 action is authorized by this file  
**Evidence index:** `docs/evidence/phase-1-m1/stage-1/EVIDENCE_INDEX.json`

## 1. Technical decision summary

| Area | Decision | Evidence |
|---|---|---|
| Runtime | Node.js `24.19.0`, official checksum-verified Linux x64 archive bundled into the one release artifact | `S1-EV-022` |
| Package manager | pnpm `11.21.0` through Corepack `0.35.0`; exact pins/lockfile | `S1-EV-001`–`S1-EV-007` |
| Database | PostgreSQL major `18`; first qualified package `18.6-1.pgdg13+2` | `S1-EV-017`–`S1-EV-023` |
| SQL stack | `pg@8.23.0`, `kysely@0.29.5`, `node-pg-migrate@9.0.0` | `S1-EV-018`–`S1-EV-020` |
| Authentication | aligned `better-auth@1.6.27` and authoring CLI `auth@1.6.27` | `S1-EV-014`–`S1-EV-016` |
| Identity isolation | fixed `staff_access` and `portal_access` namespaces plus distinct table identities | `S1-EV-016` |
| Web/API | React `19.2.8`, Vite `8.2.1`, Tailwind `4.3.3`, NestJS `11.1.29` | `S1-EV-012`, `S1-EV-013` |
| Release evidence | Syft `1.51.0`, Cosign `3.1.3`, Caddy `2.11.4` | `S1-EV-026`–`S1-EV-028` |

The complete 46-package contract is in `M1_VERSION_COMPATIBILITY_MATRIX_CORRECTED.md` and `dependency-matrix.json` (`S1-EV-001`).

## 2. Authoritative repository decision

| Property | Stage 1 decision |
|---|---|
| Host | GitHub |
| Owner | `ruisilva-bit` |
| Repository | `travelos` |
| Visibility | Private |
| Canonical repository | `https://github.com/ruisilva-bit/travelos` |
| Default branch | `main` |

These values are bootstrap decisions, not a claim that the repository already exists. Stage 1 does not create it, authenticate to GitHub, initialize Git or configure a remote.

### Branch policy

- Direct implementation changes to `main` are prohibited.
- Changes normally enter through pull request.
- Required CI checks must pass before merge.
- Architecture/security-critical changes require independent review.
- Accepted ADR changes require the ADR process before implementation.
- Customer-specific branches and forks are prohibited.

## 3. CI execution and ownership

GitHub Actions is enabled as the initial CI execution platform **once the repository is initialized in Stage 2**. Repository-owned scripts are authoritative; Actions invokes repository commands and may not implement a divergent build/test/release pipeline.

No workflow has been created or activated in Stage 1. The corrected candidate contains no `.github/`, Git metadata or product scaffold; this is asserted again by the pre-freeze validation record.

## 4. Artifact signing and trust boundary

- **Mechanism:** Cosign keyless signing with GitHub Actions OIDC.
- **Qualified tool:** Cosign `3.1.3` (`S1-EV-026`).
- **Repository identity:** `ruisilva-bit/travelos`.
- **Protected intended workflow path:** `.github/workflows/release.yml`.
- **Protected workflow source ref:** `refs/heads/main`.
- **Exact intended workflow identity URI:** `https://github.com/ruisilva-bit/travelos/.github/workflows/release.yml@refs/heads/main`.
- **OIDC issuer:** `https://token.actions.githubusercontent.com`.
- **Long-lived signing private key:** none.

Verification policy must require the exact OIDC issuer and protected workflow identity above, and provenance must identify `ruisilva-bit/travelos`, workflow, source ref and artifact digest. Signing occurs only after required CI gates. Customer-specific builds/signatures are forbidden. OIDC credentials/tokens may never enter repository files, artefacts or logs.

This section chooses a trust boundary only. Stage 1 did not create the workflow, request an OIDC token, sign an artifact, create a key or store a secret.

## 5. SBOM and release contract

Syft `1.51.0` generates SBOMs (`S1-EV-027`). The official Node archive becomes part of the one immutable versioned artifact after checksum verification (`S1-EV-022`). Cosign signs its digest and associated provenance only under the policy above. Normal controlled version updates require fresh qualification; no customer variant is allowed.

## 6. Database and authentication policy

PostgreSQL major `18` remains private/local and exact-package-pinned per release (`S1-EV-017`, `S1-EV-023`). Application startup never migrates. Better Auth `migrate` is forbidden; separate Staff/Portal generation is authoring input for one reviewed TravelOS migration chain (`S1-EV-014`–`S1-EV-016`).

Separate instances, cookies, routes, secrets, table identities and fixed schemas remain mandatory. Email equality grants no cross-realm authority. No generated SQL is product source.

## 7. TypeScript and dependency policy

Owned code remains strict and the broad semantics of `skipLibCheck` are acknowledged in the corrected matrix (`S1-EV-008`). Engines/peers, exact pins, release age, `esbuild`-only lifecycle policy, full/production audits and architecture checks are mandatory (`S1-EV-001`–`S1-EV-011`).

## 8. Explicit non-actions and later gates

This corrected decision record does **not**:

- create the GitHub repository;
- run `git init` or configure a remote;
- authenticate to GitHub;
- enable Actions or create workflows;
- create secrets or request OIDC credentials;
- sign an artifact;
- scaffold TravelOS;
- install or deploy to CT 200.

Those actions belong to Stage 2 or later after independent closure. Stage 3+ still owns real PostgreSQL constraints/privileges/migrations; Stage 4 owns reviewed auth migrations/authorization; release/deployment stages own exact-artifact, time-sync, systemd, host/TLS/firewall, backup/restore and signature-verification gates.

Stage 2 remains forbidden until the focused independent closure explicitly closes `TOS-S1-001` and `TOS-S1-002` with no new BLOCKER/HIGH.
