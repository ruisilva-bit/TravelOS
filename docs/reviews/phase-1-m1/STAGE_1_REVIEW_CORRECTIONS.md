# TravelOS Phase 1 M1 — Stage 1 Review Corrections

- **Correction scope:** `TOS-S1-001` and `TOS-S1-002` only
- **Prior candidate freeze:** `docs/reviews/phase-1-m1/STAGE_1_CANDIDATE_FREEZE.md`
- **Prior freeze SHA-256:** `1b6302ae14bec1733ae693d948191464c1672b03f9aa39b2eee11f9ccee6f31a`
- **Prior independent review:** `docs/reviews/phase-1-m1/STAGE_1_INDEPENDENT_REVIEW.md`
- **Prior review SHA-256:** `fb88c2fb6b1e02ec33e771f0a2de8b71d10efae18c400811250bcbf3296e710d`
- **Author disposition:** implemented and submitted for focused independent closure; the author does not self-close either finding
- **Stage boundary:** Stage 2 remains forbidden

## 1. Generation discipline

The six files listed by the prior freeze were not edited. Corrections use new document paths, a new bounded evidence bundle, a new validation record and a new corrected freeze. The prior freeze/review remain historical evidence for the exact bytes they assessed.

Corrected-generation implementation documents:

- `docs/implementation/M1_STAGE_1_CT200_BASELINE_CORRECTED.md`
- `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX_CORRECTED.md`
- `docs/implementation/M1_BOOTSTRAP_DECISIONS_CORRECTED.md`

## 2. Finding correction matrix

| Finding | Prior severity | Author disposition | Exact correction | Required independent reassessment |
|---|---:|---|---|---|
| `TOS-S1-001` | HIGH | Implemented; not self-closed | Added a retained, indexed and secret-scanned machine-readable evidence bundle covering `S1-EV-001`–`S1-EV-030`; recreated only the probes necessary because the original raw probe had already been removed; mapped material claims in all three corrected documents to evidence IDs; removed all disposable runtime state after capture. | Verify every index hash, evidence sufficiency, claim mapping, no fabrication/secret leakage, bounded CT non-mutation wording and cleanup. |
| `TOS-S1-002` | BLOCKER | Implemented; not self-closed | Recorded exact GitHub owner/repository/visibility/default branch, branch policy, GitHub Actions activation decision, repository-owned CI authority, Cosign keyless OIDC policy, exact intended protected workflow identity and no-long-lived-key boundary. | Verify that repository/CI/signing decisions are exact and unambiguous and that no Git/GitHub/workflow/signing/secret action occurred. |

## 3. TOS-S1-001 — preserved evidence

### Retained bundle

`docs/evidence/phase-1-m1/stage-1/EVIDENCE_INDEX.json`

- index SHA-256 at correction authoring time: `c5dce2f9217d24b4a0e4d00e12e9a9e089a62ed5676238a2ca8411d37f2bce21`;
- nine retained JSON evidence artifacts;
- complete, non-duplicated check coverage from `S1-EV-001` through `S1-EV-030`;
- every artifact result is `PASS`;
- index rows contain path, byte size, evidence IDs and SHA-256;
- the index excludes itself to avoid recursive hashing; the corrected candidate freeze hashes it.

### Evidence coverage

| Area | Evidence |
|---|---|
| Exact direct matrix, registry integrity and resolved versions | `dependency-matrix.json` — `S1-EV-001` |
| Every resolved engine/peer/lifecycle input and result | `resolved-engine-peer-graph.json` — `S1-EV-002` |
| Clean/frozen installs, full/prod audits, release age and build allowlist | `install-audit-build-policy.json` — `S1-EV-003`–`S1-EV-007` |
| TypeScript, ESLint, Vitest, architecture, Nest runtime and web build | `quality-build-results.json` — `S1-EV-008`–`S1-EV-013` |
| Better Auth Staff/Portal hashes and physical isolation | `better-auth-realm-separation.json` — `S1-EV-014`–`S1-EV-016` |
| PostgreSQL, pg, Kysely, migration and dump/restore | `postgresql-runtime-results.json` — `S1-EV-017`–`S1-EV-021` |
| Node/PGDG/Debian/release-tool provenance | `toolchain-package-provenance.json` — `S1-EV-022`, `S1-EV-023`, `S1-EV-026`–`S1-EV-029` |
| CT inventory and bounded operator non-mutation | `ct200-read-only-inventory.json` — `S1-EV-024`, `S1-EV-025` |
| Probe/runtime cleanup | `disposable-cleanup.json` — `S1-EV-030` |

The original raw probe no longer existed when correction began. Therefore the successful gates were genuinely rerun in new disposable `/tmp` roots rather than reconstructed from memory. Failed temporary probe attempts were treated as failures and corrected before the final successful records; they were not rewritten as successful historical output. The corrected docs disclose probe-only adjustments that did not alter Accepted architecture or the 46 direct pins.

The CT evidence makes only defensible claims: API GET only, no guest SSH, zero mutating requests from the correction identity and equality of selected Proxmox configuration fields before/after. It explicitly records a contemporaneous `vncproxy` task by `root@pam` and does not claim filesystem immutability or absence of other activity.

### Retention and cleanup

No credential, token, cookie, private key, password-bearing URL, package cache, binary, PostgreSQL data directory, `node_modules`, generated SQL or dump is retained. The evidence security scan records zero real findings. Its only reviewed false positive is the public npm package named `cookie` in the resolved-version map.

The dedicated probe/toolchain/Corepack/pnpm store/PostgreSQL/download/release-tool roots were removed; no process references remained and loopback port `55433` was closed (`S1-EV-030`). The pre-existing shared `/tmp/.pnpm-store` was neither used nor modified by this correction.

## 4. TOS-S1-002 — repository, CI and signing decisions

The authoritative corrected decision is in `docs/implementation/M1_BOOTSTRAP_DECISIONS_CORRECTED.md`:

- GitHub;
- owner `ruisilva-bit`;
- private repository `travelos`;
- canonical URL `https://github.com/ruisilva-bit/travelos`;
- default branch `main`;
- pull-request/required-check/independent-review/ADR/customer-fork branch policy;
- GitHub Actions enabled only after Stage 2 repository initialization;
- repository scripts own CI behavior;
- Syft `1.51.0` for SBOM;
- Cosign `3.1.3` keyless signing through GitHub Actions OIDC;
- OIDC issuer `https://token.actions.githubusercontent.com`;
- intended protected workflow `.github/workflows/release.yml` from `refs/heads/main`;
- exact intended identity URI `https://github.com/ruisilva-bit/travelos/.github/workflows/release.yml@refs/heads/main`;
- no long-lived signing private key.

No repository was created, no `git init` or remote was configured, no GitHub authentication occurred, no workflow/Actions configuration exists, no OIDC token was requested, no artifact was signed and no secret was created.

## 5. Regression statement

The correction does not change Accepted Phase 0 architecture, ADR status, M1 scope, modular-monolith boundaries, separate identity realms, publication invariants, migration ownership, private database posture, deployment model or customer-fork prohibition.

The correction adds missing evidence/provenance, quantifies the release-age policy at 1,440 minutes, accurately describes broad `skipLibCheck` semantics and settles the Product Owner-provided repository/CI/signing bootstrap decisions. The new disposable lock hash is evidence for the rerun resolved graph, not a Stage 2 product lockfile.

## 6. Closure request

The focused non-authoring reviewer must first verify every corrected-freeze hash and every evidence-index row. It must then explicitly return:

- `TOS-S1-001 — CLOSED` or `OPEN`;
- `TOS-S1-002 — CLOSED` or `OPEN`;
- any new finding with severity and evidence;
- `GO — Stage 2 may begin` only if both prior findings close and no new BLOCKER/HIGH exists.

This correction report records implementation, not independent closure.
