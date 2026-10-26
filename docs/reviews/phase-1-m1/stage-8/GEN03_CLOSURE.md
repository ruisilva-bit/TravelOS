# Stage 8 — GO / CLOSED, gen03

**Decision:** GO for Phase 1 M1 Stage 8, **CT200 DEVELOPMENT only**. Owner: Alex.

## Accepted result

| Gate | Verified evidence |
| --- | --- |
| Canonical CI | Exactly one invocation, **32/32 PASS**, consumed claim and hash-verified final receipt/log |
| Unit tests | **230/230 PASS** |
| Real PostgreSQL 18.6 | **75/75 PASS**: Stage 6 (3), Stage 7 (38), Stage 8 (34), including 23 independent revoked-capability readiness cases |
| Exact artifact | `travelos-stage8-gen03-3d6c977d`; promoted without installing dependencies or compiling on CT200 |
| Backup/restore | Custom-format backup retained at mode 0600; restored ledger/catalog parity and effective schema/table/column ACL parity across 204 relations / 17 schemas; probe absence verified |
| Migration | Head `0014_stage8_worker_activity`, 14 entries; canonical packaged migrator executed as a no-op against the already-upgraded target |
| Authenticated CT200 acceptance | **34 normal probes** and **39 controlled failure/restart probes**, through real Staff MFA and Portal flows |
| Worker | Durable dispatch, at-least-once idempotency, retry, dead-letter, UNKNOWN_OUTCOME quarantine, restart recovery and concurrent claiming exercised |
| Activity / Audit | Event/Agency/Staff/Trip/publication linkage and correlation verified; eventual Activity remains separate from synchronous immutable Audit |
| Observability | Structured allowlisted logs; fresh health/readiness; 8 fixed-name, label-free metric samples in private `metrics.prom` (0600 within 0700 directory) |
| Isolation / regressions | Stage 6/7 tests and actual Preview/Publish v1/v2, grant revocation, realm separation and Portal privilege denials PASS |
| Cleanup | Two new fixture runs CLEANED, four registered Trips cancelled, Portal identities retired; no active fixture pointers or unfinished jobs; unregistered Trip/snapshot fingerprints unchanged; one-shots inactive, ephemeral credential directories and transfer archive absent |
| Final runtime smoke | Admin API, Portal API and Worker active; 7 API/Caddy health and exact-Host probes PASS |
| Evidence | **73 execution artifacts**, exact directory/index coverage; **130/130 frozen rows** verified |
| Frozen candidate scan | **131 files**, zero unallowlisted findings |
| Independent review | **GO**, both prior findings CLOSED, zero new findings and no deferred minors |

## Exact identities

- Active release: `/opt/travelos/releases/travelos-stage8-gen03-3d6c977d`.
- Artifact SHA-256: `224747dff536535f94c49a55ab1ef1719fa7a5ccd6c44606d3c5ee8faaff98fb`.
- Source content snapshot SHA-256: `3d6c977d5db3af2865e2b57f21776c57b42586118eb04e2e0d4d8579d7ca2796` (600 files).
- Packaging baseline commit: `f84d60d07ad9747649245a3a17ab0cf1b7080f1f`. The artifact explicitly identifies **WORKING_TREE_CONTENT_SNAPSHOT_NOT_BASELINE_COMMIT**; this baseline commit alone does not claim to contain the corrected source. The closure commit contains the corrected files whose bytes match that snapshot.
- Canonical CI receipt SHA-256: `77f443d96738f2b6b48177431299c1c50b10a1997422c702119db6137a8198a3`.
- Freeze SHA-256: `644c3588dc3392469ec67f8628c84e6b782b1c465941c577c9242680b56582f9`.
- Freeze aggregate SHA-256: `e3aa5221b1b7abfd9aad2bb59aa9c6c0ea938a096ca5afeb7ebe67d6afa21459`.
- Post-freeze scan SHA-256: `02e931c82478efc1b3bfe5c77715df362a6243ef079f75e80e6a1c816c362674`.
- Independent review SHA-256: `0c14162631e1475da96dd78d4aba3c2ad29869fa20680029e252e26b3f79c7c5`.
- Independent reviewer: non-author `sa-0-fd1fa7eb`, delegation `deleg_76489439`, model `gpt-6-luna`.
- Normal invocation: `d3b183760cfd42339c9abe4b1ced5f29`.
- Controlled invocation: `013800d9c0eb4e179912db8357722bb4`.

## Findings and operational rulings

- **S8-OBS-001 HIGH:** CLOSED by independent review; real private metric export implemented and exercised.
- **S8-OBS-002 MEDIUM:** CLOSED by independent review; readiness privilege coverage corrected and adversarially tested.
- **Open findings: none. Deferred minors: none.** Gen02 remains NO-GO historical evidence, never relabelled as GO. Its original source bytes remain available at the baseline commit and the preservation report verifies all original freeze rows.
- Mutable qualification/build failures did not create new immutable candidates. The first evidence-preparation attempt failed before freeze and remains preserved as local state; no consumed CI was repeated.
- The initial multiline backup JSON parsing failure occurred after successful remote cleanup; original output was decoded without repeating that backup. Raw NULL versus explicit owner-default ACL differences were retained and separately qualified using PostgreSQL `acldefault`, not mistaken for lost runtime privileges.
- Inactive DynamicUser oneshots may clear `systemctl InvocationID`; the normal runner's exact report was recovered from the artifact-bound journal invocation without replaying acceptance.
- CT200 had no curl; the read-only Host/health probe used its installed Python urllib. No candidate bytes or network/security configuration changed for that probe.
- Production/legal approval is excluded. Misinterpreting this DEVELOPMENT GO as production permission would bypass separate mandatory gates. Git sealing is the author's subsequent verification, not an action claimed by the reviewer.

## Repository seal and reproduction

Keep branch `phase-1/stage-8` and its worktree. The annotated local tag **`travelos-phase-1-m1-stage-8-gen03-go`** identifies the closure commit containing this record, corrected implementation, rejected gen02 evidence, accepted gen03 evidence and independent adjudication. No merge or push is authorized or performed. Local `.hermes/state/` is intentionally excluded from Git.

The evidence-directory-local `.gitattributes` declares exact-path whitespace exceptions for nine immutable execution logs. It preserves their reviewed trailing spaces or final blank line instead of editing frozen evidence; no repository-wide whitespace rule or sensitive-data detector is relaxed.

Run from the repository root:

`python3 docs/reviews/phase-1-m1/stage-8/verify-gen03.py`

The checker rehashes the complete freeze, source snapshot, execution index and final scan, then verifies the independent GO and its adjudication. The separate closure-scope scan includes the derived review/closure/checker files without rewriting the reviewed freeze.

**Stage 9 actions = 0.** Stage 8 does not implement or authorize the Stage 9 UI. This is a DEVELOPMENT stage closure, not a production release.
