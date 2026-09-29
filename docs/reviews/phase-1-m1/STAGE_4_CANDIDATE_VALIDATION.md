# TravelOS Phase 1 M1 — Stage 4 Candidate Validation

- **Status:** Author qualification complete; independent non-authoring review required
- **Validation timestamp (Europe/Lisbon):** `2026-09-21T15:20:46+01:00`
- **Accepted predecessor:** `docs/reviews/phase-1-m1/STAGE_3_CORRECTED_CANDIDATE_FREEZE.md` — SHA-256 `a973ccc403844bd7e6dc10610117965af761abe1c3197d3ee1f3b9b2ad1ed9d7`; closure SHA-256 `682fbcd9d42edb277eb76a1d886f1a57337a19deb11742e0ab7e4a1d345ce380`
- **Scope:** Better Auth Staff/Portal realm integration; root Agency bootstrap; Staff RBAC/session authorization; migration integrity; disposable PostgreSQL qualification; controlled DEVELOPMENT CT 200 migration; evidence and candidate-freeze tooling
- **Excluded scope:** production deployment, public exposure, DNS/TLS/firewall changes, production credentials, customer data, Portal Trip grants/documents, business APIs and UI rollout

## Author-side qualification

| Gate | Result | Evidence |
|---|---|---|
| Migration checksum chain through `0005` | PASS | `docs/evidence/phase-1-m1/stage-4/migration-checksums.json` |
| Better Auth generated-schema drift | PASS | `docs/evidence/phase-1-m1/stage-4/auth-schema-drift.json` |
| Disposable PostgreSQL qualification | PASS — 6 integration tests; package build and cleanup pass | `docs/evidence/phase-1-m1/stage-4/disposable-*.json` |
| Controlled CT 200 migration | PASS — ledger `0001` through `0005` | `docs/evidence/phase-1-m1/stage-4/ct-200-migration.json` |
| CT 200 post-migration access/invariant probes | PASS — runtime isolation, root uniqueness, last Owner, epoch bump and rollback cleanliness | `docs/evidence/phase-1-m1/stage-4/ct-200-post-migration-validation.json` |
| CT backup/restore probe and temporary access cleanup | PASS | `docs/evidence/phase-1-m1/stage-4/ct-200-preflight-restore-cleanup.json` |
| Stage 4 evidence index | PASS — 13/13 matched | `docs/evidence/phase-1-m1/stage-4/EVIDENCE_INDEX.json` |
| Pre-index owned-source/evidence scan | PASS — zero findings; 10 explicit synthetic-fixture email suppressions; no values emitted | `docs/evidence/phase-1-m1/stage-4/source-safety-pre-index.json` |
| Repository regression before candidate freeze | PASS — 23 CI gates | `docs/evidence/phase-1-m1/stage-4/repository-regression.json` |

The temporary SSH key, CT authorized-key entry, local tunnel, CT-side scripts and temporary database backup were removed only after the full restore probe and post-migration validation passed. The CT target remains a synthetic DEVELOPMENT environment; it is not a production approval.

## Exact evidence and pre-final collection

The Stage 4 evidence index declares 13 artifacts, parsed/matched 13/13, with missing, unexpected, duplicate, invalid, size-mismatch and hash-mismatch counts all zero. Its SHA-256 is `3d81afd58d88dd35e48252f958bc598ea7125916af47ce4897f896a0f2d20bc6`; its deterministic artifact aggregate is `57f1c37fe6337c3937b4106879b1206dfeb3ead08daecb8eeebece9a493a3111`.

The deterministic pre-final collector passed with 259 entries and aggregate `8d2c2c37147d1c6ac3133fdb236642a06a593fe7b89a2d3e728d04a94ffa779d`. It intentionally excludes this validation while it is being authored and is not freeze-eligible. The final collector must include this validation, exclude its own manifest, reproduce identically twice, and be independently verified before review begins.

## Assertions for independent review

The reviewer must verify the frozen bytes before semantic review and challenge at least these claims:

1. Realm separation is physical in database schema, runtime roles, HTTP bridge configuration, contract types and session cookies; email equality cannot cross the realms.
2. Application/domain packages do not import Better Auth, NestJS, `pg`, Kysely or database row types; Better Auth is confined to adapters/composition bridges.
3. `INTERNAL_ONLY` and Portal grant boundaries remain unchanged; Stage 4 does not introduce a Portal workspace read path.
4. Root Agency uniqueness, Agency-local role/membership references, last-active-Owner protection and authorization-epoch invalidation hold under database transaction failure/rollback paths.
5. The first-owner bootstrap does not create a public signup capability or store/reveal a raw bootstrap token.
6. Migration order/checksums, evidence integrity, target cleanup and final source-safety scan are exact.

## Author decision

All author-owned implementation, disposable PostgreSQL, controlled DEVELOPMENT CT 200, evidence-index and pre-freeze qualification gates above pass. No author finding is self-closed. The candidate is ready for deterministic final freeze and independent adversarial review; it is **not** yet Stage 4 closure or production release approval.
