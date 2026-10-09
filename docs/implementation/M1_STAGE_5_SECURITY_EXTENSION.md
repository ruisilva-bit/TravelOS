# TravelOS Phase 1 M1 — Stage 5 Finance-Cost Permission Extension

**Status:** Active Phase 1 M1 security-extension candidate; not a Stage 5 closure or production authorization.  
**Authority:** Phase 0 accepted baseline, ADR-008, `AGENTS.md` and the approved Phase 1 M1 Stage 5 scope.  
**Protected baseline:** `docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json`.

## 1. Non-amendment and lineage

`docs/PERMISSIONS.md` is an accepted Phase 0 record protected by
`docs/reviews/PHASE_0_ACCEPTED_BASELINE.md`. Its historical bytes remain unchanged.
This document is the Phase 1 M1 extension record for the code-owned permission
introduced by the Stage 5 slice; it does not rewrite, supersede or reinterpret
Phase 0 architecture.

ADR-008 already authorizes a code-owned, versioned Staff permission registry,
Agency-owned configurable Roles and server-side default-deny checks. This
extension adds one Stage 5 capability within that accepted model; it does not
introduce a policy engine, role-name authorization, a new principal type, a new
security realm or a Portal capability.

## 2. Registered capability

| Property | Stage 5 value |
|---|---|
| Permission ID | `finance.manage_costs` |
| Registry version | `3` |
| Allowed scope | `AGENCY` only |
| Allowed access level | `ALL` only |
| Protected data | `INTERNAL_ONLY` supplier-cost amount and internal supplier-cost note |
| Portal eligibility | None; the capability never grants Portal access or a Portal contract field |
| Owner template | The bootstrap owner template receives every code-owned registry permission, including this one |

The restriction to `AGENCY` / `ALL` is deliberate. Stage 5 does not persist
trusted supplier-cost ownership or OrganizationUnit ancestry, so `OWN`, `TEAM`
and `ORGANIZATION_UNIT` are not valid for this capability. A later scope model
requires its own documented extension, domain/persistence support and adversarial
qualification; this record is not a placeholder authorization for it.

## 3. Least-privilege semantics

`finance.manage_costs` permits only the Stage 5 command paths that accept or
change the restricted supplier-cost payload. It is required in addition to the
applicable composite read and edit permissions:

- creation requires it because the M1 request always contains the
  `INTERNAL_ONLY` supplier-cost amount and note;
- internal supplier-cost-note mutation requires it;
- visibility remains a separate `finance.view_costs` capability.

It does **not** grant price visibility or price editing, margin visibility,
payment management, generic finance administration, document access, publication,
role administration or any implicit Portal access. A role label—Owner included—is
not an authorization bypass; the effective, active, Agency-scoped permission
assignment is evaluated server-side for every command and inside the repository
transaction.

## 4. Enforcement boundary

`packages/backend-core/src/staff-access/permission-registry.ts` owns the
registry definition. `packages/backend-core/src/agency-organization/agency-bootstrap.ts`
uses the complete code-owned registry for the bootstrap owner template without
introducing role-name checks. `m1-staff-operations.ts` reconstructs untrusted
input, resolves a Staff session, reloads the authorization snapshot, validates
its Agency and epoch, and evaluates the fixed operation capability set before
calling the repository. The backend-core package exports this authorization-
enforcing application facade, not the raw `m1-trip-slice.ts` command functions.
The database package exposes its composed PostgreSQL Staff operations, not a raw
repository factory. At the persistence boundary, operation-specific permission
sets are compared with immutable policy constants and the persisted session ID,
Agency, principal and epoch are revalidated inside the transaction; caller-
supplied permission metadata cannot weaken the required policy.

The Stage 5 PostgreSQL qualification exercises the live adapter, role/session
snapshot, cross-Agency denial and restricted mutation paths. Unit and route
regressions exercise missing-capability denial, Agency/ALL-only scope handling
and the closed package-export boundary.

## 5. Fail-closed protected baseline and generation order

`tooling/ci/verify-stage-5-security-extension-baseline.mjs` verifies both
lineages before and after the authoritative `ci:verify` run:

1. the immutable Phase 0 manifest and all 40 protected files still match their
   accepted SHA-256 values and the recorded source commit;
2. the active Phase 1 extension manifest has its candidate-pinned SHA-256, exact
   enumerated file set, unique regular files, per-file SHA-256 and deterministic
   aggregate;
3. the manifest, documentation, code registry, owner-template relationship,
   M1 authorization boundary, package scripts and Stage 5 candidate runner retain
   the declared capability semantics.

The FINAL-10 record is preserved at
`docs/reviews/phase-1-m1/STAGE_5_FINAL_10_REJECTION_RECORD.md`: its sole CI
invocation was consumed and failed at `stage5-security-extension:pre` because
the package script changed after the previous manifest captured `package.json`.
That generation is rejected; its tag, receipts, pre-CI index and prior Phase 1
manifest remain historical evidence and are not rewritten.

For FINAL-11, the generator verifies the exact FINAL-9 Phase 1 baseline in its
rejected tag worktree, checks the FINAL-10 rejection tag/receipts/guard, verifies
Phase 0 lineage, and compares the complete protected path set. It records the
only approved content deltas from the last passing protected baseline:
`package.json` (FINAL-11 candidate wiring) and this extension document (the
successor-generation decision). Every FINAL-11 runner, evidence tool and package
reference must reach its final bytes before the new Phase 1 manifest is written.
The focused baseline preflight then proves predecessor lineage, exact hashes,
the unchanged protected path set, FINAL-11 package and runner bindings, and zero
missing, unexpected, duplicate or unauthorized drift. Any protected-input
change after generation invalidates that preflight; regenerate the successor
baseline only in a new authorized candidate.

FINAL-11 is preserved as `REJECTED / CI CONSUMED / FORMAT-GATE FAILURE` in
`docs/reviews/phase-1-m1/STAGE_5_FINAL_11_REJECTION_RECORD.md`; its one
`corepack pnpm ci:verify` invocation failed at `format:check` because candidate
tooling formatting had not been checked before authorization. FINAL-11's log,
execution receipt, `CI_FAILED` evidence index, local-only invocation guard, and
predecessor Phase 1 baseline are immutable historical evidence. The exact
pre-format source snapshot is separately hash-recorded in the rejection record.

For FINAL-12, the active package scripts and authoritative runner are finalized
before the active Phase 1 baseline is regenerated. The FINAL-12 baseline retains
the original Phase 0/Phase 1 ancestry and the complete FINAL-11 generation record,
then appends a distinct FINAL-12 protected-file delta. Its pre-CI readiness runs
the full `format:check` gate against the finalized source/package inputs and
binds that receipt to the evidence index before writing the new invocation
guard. No baseline is captured and then followed by protected-input edits; any
later protected change requires another sequential candidate.

For FINAL-13, the candidate-specific runner, package scripts, and tooling/config
are finalized before generating the successor Phase 1 baseline. The baseline
retains the FINAL-12 baseline and its complete consumed lint-failure lineage,
and enumerates only the approved package/document deltas. Readiness verifies
the exact protected paths and hashes, predecessor lineage, FINAL-13 package and
runner bindings, missing/extra/duplicate entries, and unauthorized drift; it
also runs the complete `format:check` and `lint` gates before the invocation
guard can be created. No protected candidate input may change after baseline
generation; such a change requires a new successor generation.

The FINAL-14 successor carries forward all 48 IDs without author-closing any
finding, adds a separately adjudicated citation-correction item, and preserves
FINAL-13's exact NO-GO receipt, freeze, archive, evidence index, baseline,
consumed CI log/receipt and invocation guard. Its candidate generation order is
strict: finalize FINAL-14 runner/script references and package scripts, finalize
all candidate tooling/configuration, then capture the new Phase 1 baseline and
verify the exact protected paths, hashes, package/runner pins, predecessor
lineage, missing/extra/duplicate entries, and unauthorized drift before arming
the sole CI invocation. The FINAL-14 baseline must retain the exact FINAL-13
baseline bytes and enumerate only the approved package/document deltas.

FINAL-14 also re-executes the reviewer-identified paths through the repository's
disposable PostgreSQL runner: Admin-role forged revision-marker writes, bigint
lock-version migration/CAS, real deadlock-to-HTTP mapping, and a real stale
supplier-cost compare-and-swap through the registered Admin HTTP route. Capture
the complete PostgreSQL integration log, execution and cleanup receipts,
package/runtime provenance, and bind the qualification to the exact integration
test source hash. The candidate-specific source-scan mode must consume the
current FINAL-14 evidence index and current source collector, require the
correction matrix during evidence scans and both validation/freeze during the
final candidate scan, and write its post-freeze receipt outside the collected
scope only after scanning completes. Preserve FINAL-13's inconsistent scan as
historical evidence; never rewrite it.

The FINAL-14 evidence index and correction matrix retain all predecessor
lineage. The matrix citations must point to verified FINAL-14 source lines, and
all 49 carried/current IDs remain pending until an independent read-only review
adjudicates them. A CI pass, author assertion, or generated receipt is not
independent closure.

FINAL-15 narrows the Stage 5 registry's `staff.view` and `finance.view_prices`
definitions to `AGENCY`/`ALL` and increments the registry version to 3. M1
resources do not yet carry trusted OrganizationUnit ownership or ancestry, so
the broader scope/access combinations were not operationally enforceable.
OrganizationUnit, OWN and TEAM assignments remain unsupported until ownership
is persisted and ancestry is resolved from trusted data inside the authorization
path and qualified end-to-end. The FINAL-15 successor baseline preserves the
exact FINAL-14 baseline and records only this intentional permission/document,
package and candidate-documentation delta set.

The paired negative test mutates a disposable Git worktree to prove rejection
of a Phase 0 permission-document change, a Phase 1 extension-document change
and a Phase 1 manifest change. The active baseline is candidate evidence, not a
rewrite of the historical Phase 0 or prior Phase 1 baselines, and it authorizes
no Stage 6 actions.

The **M1 enforcement boundary** keeps this permission set limited to the capabilities
that are backed by persisted Agency-scoped facts and transaction-level checks. For
FINAL-16, the failed FINAL-15 baseline generation remains immutable evidence: its
protected manifest hash is recorded in the successor lineage, its semantic
verification failure is corrected here, and no FINAL-15 CI invocation occurred.

FINAL-17's canonical CI completed PASS exactly once, but its post-CI evidence
wrapper failed and FINAL_CANDIDATE source coverage rejected the generation
before freeze. Preserve both the authoritative CI receipt and the wrapper/scope
failure records; FINAL-17 has no deterministic freeze or independent review.
FINAL-18 corrected source-scope completeness without manufacturing candidate
validation or freeze documents for generations rejected before those gates:
historical correction matrices and evidence indexes remain required, while
candidate validation/freeze inputs are required only for generations that
actually reached a freeze and for the active candidate being frozen. FINAL-18
was subsequently rejected before CI because its final readiness verification
failed on the working-tree snapshot/guard contract; the exact failure is
preserved in `.hermes/state/stage5-final18-preflight-failure-01.json`. Its
baseline, evidence index and failed local guard remain historical and must not
be rewritten or reused as a green readiness result. No CI invocation occurred
for FINAL-18, and no authorization was consumed by that attempt.

FINAL-19 is the explicitly authorized sequential successor. It carries the 49
findings without author-closing any item, preserves the rejected FINAL-18
disposition and fixes the snapshot contract before any CI invocation. The
original remaining CI authorization applied only to FINAL-19 and was conditional
on its own readiness PASS; FINAL-19 did not consume it. The user later explicitly
authorized FINAL-20 as a sequential successor and granted one CI invocation only
after FINAL-20 readiness PASS. Every candidate input, runner, package reference,
matrix and evidence artifact must reach their final bytes before baseline
generation. Stage 6 actions remain zero.

FINAL-19 was rejected before readiness PASS: its preflight created the execution
receipts and pending report, then the first PRE_CI evidence-index write failed
because `migration-checksums.json` was listed in the exact artifact contract but
had not been copied into the FINAL-19 evidence directory. The failure receipt
`.hermes/state/stage5-final19-preflight-failure-01.json` records the exact
missing path, ten completed preliminary checks, no index, no freeze guard, no
CI invocation, and zero Stage 6 actions. Preserve the 78 written FINAL-19
artifacts and pending report exactly; do not manufacture the missing artifact
or a FINAL-19 index.

FINAL-20 is the explicitly authorized sequential successor. It carries all 49
findings without author closure, archives FINAL-19's existing bytes and failure
receipt without presenting them as successful evidence, and materializes the
exact migration checksum bytes before its first evidence-index write. Its
single remaining authoritative CI invocation may occur only after its own
readiness verifier returns PASS. The FINAL-20 baseline must be generated from
the exact FINAL-19 baseline, and any later readiness, evidence, freeze or review
failure remains a distinct preserved generation. Stage 6 actions remain zero.

FINAL-20's CI PASS and verified freeze remain immutable. Its FINAL_CANDIDATE
scan did not execute because the collector incorrectly required FINAL-18
validation/freeze artifacts even though FINAL-18 was rejected before those
states. The failure is an evidence lifecycle-model defect, not missing history.

FINAL-21 corrects that model through the explicit, fail-closed
`tooling/ci/stage-5-generation-lifecycle-ledger.json`. Historical coverage is
based on each generation's recorded lifecycle state, not candidate numbering
or directory discovery. Required artifacts are checked only for reached states;
non-applicable artifacts remain absent, unexpected artifacts are rejected, and
pinned historical hashes remain verified. In particular, FINAL-18 stays
`REJECTED_PRE_CI` with no fabricated validation or freeze. FINAL-20 remains
`FROZEN_REJECTED`, with its exact validation, freeze, CI and scan-failure
records preserved. Negative tests cover missing/extra artifacts, duplicate
entries, invalid transitions, predecessor gaps, incorrect hashes and exact
FINAL-20 record retention. FINAL-21 does not alter Stage 5 business/domain
behavior and does not authorize Stage 6 actions.

FINAL-21 subsequently consumed its sole CI invocation and failed at the
security-extension pre-gate because the active package script still resolved
the predecessor verifier. Its CI log, execution receipt, `CI_FAILED` index,
baseline and 49-finding matrix are preserved. FINAL-22 is the sequential
successor. Active Stage 5 scripts and runner paths are bound through one
current-candidate manifest, and the candidate-coherence pre-gate rejects
predecessor references before baseline verification or CI. FINAL-22 must
qualify its own focused tests, disposable PostgreSQL, immutable predecessor
lineage, exact protected-file delta, security scan and one-shot readiness
before its single authorized CI run. No author-side pass closes a carried
finding; only an independent review of the final frozen bytes can do so.
FINAL-22 authorizes no Stage 6 action or deployment.

FINAL-22 attempt 02 generated its baseline, but readiness failed at the
format gate before an invocation guard or CI run. Its exact baseline,
generation receipt, failed-readiness record and rejection record are retained;
there is no FINAL-22 CI receipt or final evidence index to invent. FINAL-23
is the sequential successor. It must verify that rejected-pre-CI predecessor
lineage, requalify on its own bytes, pass all readiness gates before its one
separately authorized CI invocation, and produce final evidence, exact-byte
freeze and independent review. No author-side correction closes any of the
49 carried findings. FINAL-23 authorizes no Stage 6 action or deployment.

FINAL-23 pins the rejected predecessor's baseline, generation receipt,
readiness-failure receipt, correction matrix and rejection record by SHA-256;
it does not require or fabricate predecessor validation, freeze or CI artifacts.
Its `PRE_CI` evidence index covers the candidate evidence directory plus the
matrix, current baseline and candidate manifest. The `FINAL` index includes
the authorized CI receipt/log and final source scan; it deliberately does not
index the later review-directory validation/freeze or the post-freeze scan.
Those three outputs have a separate read-only provenance gate: after a PASS
CI index, author the validation from that CI and evidence, collect the freeze
twice from the ordered `FINAL_EVIDENCE` source scope with validation present
and self/scan absent, then write the `FINAL_CANDIDATE` sensitive-data scan.
That scan must cover the exact final evidence index, validation and freeze,
excluding only its own output; provenance independently recomputes its scope,
ordered hashes and aggregate and verifies the freeze and index bytes. A
`FINAL_EVIDENCE` freeze alone is not review eligibility. Only a passing
`FINAL_CANDIDATE` scan/provenance and independent adjudication of all carried
findings can close Stage 5. Post-freeze input drift requires a successor, not
an in-place rewrite.

FINAL-23 executed its separately authorized CI once after GREEN readiness and
an armed byte-matching guard; all 28 CI gates passed. Its final evidence index,
author validation, twice-collected freeze and `FINAL_CANDIDATE` scan were
created. The post-freeze provenance gate then failed because the source-scope
collector included its own final-candidate scan output; a PASS sensitive-data
scan does not cure the failed provenance gate. FINAL-23 is rejected after
freeze, with its exact CI, index, validation, freeze, scan, failure receipt and
rejection record preserved. The frozen source rows were copied byte-for-byte
to a separately hashed historical archive before successor source edits.
There is no independent GO and no retroactive FINAL-23 closure.

FINAL-24 is the sequential successor. Its collector must exclude only its
**active** `finalization.scan` receipt while retaining historical predecessor
scans; fixtures must prove self-inclusion rejection when deliberately injected,
and a read-only post-write scope recomputation must match the scan's ordered
bytes. The FINAL-23 frozen validation/freeze, successful one-shot CI and
post-freeze failure are all pinned by SHA-256, not collapsed into a pre-CI
rejection. FINAL-24 uses separate readiness and invocation-guard sidecars.
Its one separately authorized CI invocation is conditional on its own GREEN
readiness and armed guard; no predecessor authorization transfers. Its final
index, validation, freeze, scan, provenance PASS and independent adjudication
of all 49 findings are distinct gates. No Stage 6 action or deployment is
authorized.

FINAL-24 corrected the collector's self-inclusion and passed its separately
authorized one-shot CI, final index, author validation, double collection and
67-file sensitive-data scan. Its post-freeze provenance gate nevertheless
failed because the freeze verifier still expected the scan output **inside**
the same source collector it must be excluded from. The candidate is rejected
after freeze; its exact 2,129-row frozen source was archived before successor
edits. Neither a PASS CI nor a PASS scan makes that failed provenance a GO.

FINAL-25 is the sequential successor. The freeze verifier must require the
active scan receipt to exist as a separate regular file at the post-scan gate
while proving it is **absent** from the source-scope collection. At the
pre-scan gate it must prove that no scan receipt yet exists. A disposable
pre-CI fixture exercises both successful states and rejects missing,
self-included and prematurely present scan receipts. The prior generation's
CI, final index, validation, freeze, scan, failure and archive remain pinned.
FINAL-25 cannot consume another candidate's CI authorization; its own CI is
conditional on separate authorization, GREEN readiness and an armed guard.
The final scan/provenance and independent review remain separate gates.
Stage 6 actions: zero.
