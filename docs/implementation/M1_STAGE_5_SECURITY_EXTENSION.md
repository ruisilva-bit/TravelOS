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
| Registry version | `2` |
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
its Agency and epoch, and evaluates the required capability before calling the
repository. The Admin HTTP adapter consumes only that authorization-enforcing
application facade; raw M1 use cases and the raw repository are not package
exports.

The Stage 5 PostgreSQL qualification exercises the live adapter, role/session
snapshot, cross-Agency denial and restricted mutation paths. Unit and route
regressions exercise missing-capability denial, Agency/ALL-only scope handling
and the closed package-export boundary.

## 5. Fail-closed protected baseline

`tooling/ci/verify-stage-5-security-extension-baseline.mjs` verifies both
lineages before a full CI run:

1. the immutable Phase 0 manifest and all 40 protected files still match their
   accepted SHA-256 values and the recorded source commit;
2. the Phase 1 extension manifest has its pinned SHA-256, exact bounded file
   set, unique regular files, per-file SHA-256 and deterministic aggregate;
3. the manifest, documentation, code registry, owner-template relationship,
   M1 authorization boundary and CI wiring retain the declared capability
   semantics.

The paired negative test mutates a disposable Git worktree to prove rejection
of a Phase 0 permission-document change, a Phase 1 extension-document change
and a Phase 1 manifest change. The verifier runs before and after the
one-authoritative-run `ci:verify` sequence. This baseline becomes historical
closure evidence only after FINAL-9 evidence, deterministic freeze and a new
independent read-only review; it authorizes no Stage 6 actions.
