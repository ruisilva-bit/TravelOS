# TravelOS Phase 1 — Stage 2 Independent Review

- **Reviewer:** Alex, acting as an independent non-authoring reviewer
- **Review completed:** 2026-08-21T09:23:39Z
- **Candidate reviewed:** exact frozen candidate defined by `docs/reviews/phase-1-m1/STAGE_2_CANDIDATE_FREEZE.md`
- **Review posture:** adversarial, evidence-led and read-only with respect to the 203 frozen entries
- **Candidate disposition:** **NO-GO**

## 1. Independence and scope

This review did not modify or repair any byte in the frozen candidate, did not begin Stage 3, and did not mutate CT 200. Adversarial mutations and bypass probes were performed only in disposable copies under `/tmp`. This report is a new review artifact outside the 203-entry frozen manifest.

The review covered:

1. freeze and authoritative-baseline integrity;
2. protected-baseline and formatter controls;
3. exact pins, workspace policy, clean install and lifecycle-script evidence;
4. architecture fences, the negative fixture and composition-root separation;
5. configuration contracts and generated schema;
6. rejected-technology, source-secret and browser-bundle controls;
7. five deployables, evidence indexing and final-byte correspondence;
8. the Stage 3 boundary and CT 200 non-mutation narrative.

Severity is intentionally strict:

- **BLOCKER:** immediate security or integrity failure with no safe closure path;
- **HIGH:** material foundational defect that can let an architectural or security invariant pass falsely;
- **MEDIUM:** meaningful control, contract or reproducibility defect requiring correction;
- **LOW:** bounded weakness or ambiguity that should still be corrected.

Classification:

- **Category A:** defect in the Stage 2 candidate; correct and re-freeze before closure.
- **Category B:** legitimate later-stage gate; not by itself a Stage 2 defect.

## 2. Freeze integrity — PASS

Integrity was verified before substantive review.

| Check | Recomputed result |
|---|---:|
| Declared manifest entries | 203 |
| Parsed manifest entries | 203 |
| Matched files, sizes and SHA-256 values | 203 |
| Reviewable files including the freeze document | 204 |
| Missing files | 0 |
| Mismatches | 0 |
| Extra rows | 0 |
| Duplicate paths | 0 |
| Symlink entries | 0 |
| Freeze SHA-256 | `acf699c0f48bba1c87df0bf4ed1f9fe64936f2e7a15bbd95633ff1fa4d3822d9` |
| Manifest aggregate | `ccc223d7ef8847ceceb260f19853300792a24fe8df6e6729e63061d17a851e5e` |

The frozen candidate was therefore eligible for review. No current-workspace substitution was used to excuse a frozen-byte mismatch.

## 3. Authoritative baseline — PASS

| Baseline | Recomputed result |
|---|---|
| `IDEA.md` | `2c7be6b7154835a1301118670a33f2c8b9d9f8a0f178b9565515ab2484a2f524` |
| `AGENTS.md` | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| Accepted Phase 0 checks | 40/40 |
| Stage 2 formatter targets | 114 |
| Formatter/protected-baseline overlap | 0 |

The protected-baseline verifier passed independently. No protected Phase 0 file mutation was found.

## 4. Independently reproduced evidence

The following candidate claims were independently reproduced or recomputed:

- the Stage 2 evidence index has SHA-256 `25df1c53e1da00b6cbc8e2c3e7ee867f216c17ee2058ef77df882e1691b1b55e`;
- all **19/19** indexed evidence artifacts matched their declared byte counts and hashes;
- the validation report hash is `6876c396871229f79799c811797054271d7f12b336c73f6da60a3c3164bc4f05`;
- the implementation tree contains **124 files** with aggregate hash beginning `5cef7513`;
- an independent fresh-store install used Node `24.19.0`, Corepack `0.35.0` and pnpm `11.21.0` across **15 workspace projects**;
- the lockfile remained unchanged and the only observed lifecycle execution was esbuild's approved postinstall;
- `architecture:check` reproduced **42 modules / 32 dependencies / 0 cycles / 0 violations**;
- the invalid Portal fixture exited `1` with exactly the intended `portal-fixture-cannot-import-backend-core` violation;
- all five deployables built and smoked: separate Admin and Portal browser bundles, both APIs bound ephemeral loopback ports and returned HTTP 200, and the Worker transitioned `RUNNING` to `STOPPED`;
- the aggregate `ci:verify` sequence passed all 14 gates once supplied all of its hash-anchored baseline inputs;
- the frozen implementation contains no database runtime activation, migrations, auth runtime wiring or CT 200 activation;
- no CT 200 mutation, guest SSH, Proxmox operation, deployment, service, user, database or networking action was found in the Stage 2 evidence.

These positive results are real, but they do not neutralize the Category A findings below.

## 5. Category A findings

### TOS-S2-001 — HIGH — Architecture gate permits framework/vendor leakage into core

**Affected controls**

- `tooling/architecture/dependency-cruiser.cjs`
- `tooling/architecture/check.mjs`
- `eslint.config.mjs`
- `tooling/ci/tsconfig.typecheck.json`
- package dependency declarations and core package boundaries

**Evidence**

In a disposable exact-candidate copy, each of these changes to `packages/backend-core/src/index.ts` passed `lint`, `typecheck` and `architecture:check`:

1. a direct static import of `better-auth`;
2. a static import through the qualified Better Auth CLI package `auth/api`;
3. an import of `@travelos/design-system`, creating an indirect React dependency;
4. a computed dynamic import of `better-auth`.

The direct vendor edges were not represented in the reported production dependency graph. The detected design-system edge was not forbidden. The graph therefore remained green despite imports that violate the accepted rule that domain/application code imports no vendor SDK, NestJS, Kysely, HTTP, database row type or adapter/framework implementation.

A related inspection showed that Admin/Portal package subpaths are globally resolvable but not root-specifically fenced: a Portal root is not explicitly forbidden from importing `@travelos/contracts/admin`, and an Admin root is not explicitly forbidden from importing the Portal contract surface. The current negative fixture proves one resolved source-path edge; it does not exercise the full published package surface or the direct-vendor/indirect-framework cases.

**Concrete failure scenario**

A later domain/application module imports Better Auth directly, imports a framework-bearing internal package, or imports the wrong Admin/Portal contract subpath. Lint, typecheck and the architecture gate all remain green, falsely certifying the dependency rule.

**Consequence**

This is a material false-negative in the principal Stage 2 architecture control. It can permit vendor coupling and trust-surface collapse before Stage 3 implementation begins.

**Required correction**

1. Make external package imports visible to architecture enforcement.
2. Add explicit restricted-import enforcement independent of Dependency Cruiser.
3. Enforce package dependency declarations rather than relying on workspace/transitive resolution.
4. Reject indirect framework/vendor leakage through local packages.
5. Restrict or analyze computed/non-literal dynamic imports in protected production source.
6. Add root-specific Admin/Portal contract rules.
7. Add negative fixtures for direct vendor imports, indirect local-package leakage, published package specifiers, Admin/Portal contract inversion and dynamic imports.
8. Include or separately cruise relevant build/generation tooling rather than presenting an `apps`/`packages` graph as whole-repository coverage.

This HIGH Category A finding is independently sufficient for NO-GO.

### TOS-S2-002 — MEDIUM — Workspace lifecycle policy is not structurally verified

**Affected controls**

- `tooling/ci/verify-pins.mjs`
- `pnpm-workspace.yaml`
- `tooling/ci/capture-stage-2-evidence.mjs`
- `docs/evidence/phase-1-m1/stage-2/clean-frozen-install.json`

**Evidence**

`verify-pins.mjs` regex-checks the presence of `minimumReleaseAge: 1440`, `esbuild: true` and the accepted lodash override. It does not parse the YAML policy and prove exact key-set equality. In a disposable copy, an additional `allowBuilds` entry did not fail pin verification. The same weakness applies to unproven extra release-age exclusions.

The final evidence then reports `approvedBuildScripts: ["esbuild"]` as a fixed value. It accepts absent lifecycle output when shared-cache reuse counters appear complete. The retained artifact records no observed install scripts and attributes the silence to cache reuse; it does not preserve sufficient raw executable lifecycle evidence to reconstruct that claim independently.

The exact frozen dependencies did independently install with only esbuild observed. The defect is in the enforcement/evidence mechanism, not a claim that the current lockfile executed another script.

**Concrete failure scenario**

An additional package is approved beneath `allowBuilds`, followed by a cached install that emits no lifecycle line. The controls can continue to report “esbuild only.”

**Consequence**

The approved-build-script and minimum-release-age policies can drift without a failing gate.

**Required correction**

- Parse `pnpm-workspace.yaml` structurally.
- Require exact equality for the approved `allowBuilds` map and release-age exclusion set.
- Validate effective pnpm settings rather than hardcoding reported values.
- Inventory lifecycle-capable packages from the frozen lockfile.
- Retain a bounded, verifiable lifecycle execution/event report generated entirely by frozen repository-owned tooling.
- Tie that report directly to the frozen manifest aggregate.

### TOS-S2-003 — MEDIUM — Exact frozen manifest is not self-contained for aggregate verification

**Affected controls**

- `docs/reviews/phase-1-m1/STAGE_2_CANDIDATE_FREEZE.md`
- `tooling/ci/verify-protected-baseline.mjs`
- `tooling/ci/verify.mjs`

**Evidence**

A directory containing exactly the 203 manifested entries installed and built, but `ci:verify` failed because it required the non-manifest input:

`docs/reviews/PHASE_0_ACCEPTED_BASELINE.md`

The freeze prose records that file's SHA-256 (`bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb`), but the file is not a frozen manifest row. Supplying that exact hash-anchored file allowed all 14 aggregate CI gates to pass.

**Consequence**

The exact 203-entry candidate cannot execute its authoritative aggregate verifier without retrieving one additional file from the surrounding workspace. Prose anchoring prevents arbitrary substitution, but it does not make the candidate complete or independently materializable.

**Required correction**

Include every executable verification input, including the accepted Phase 0 baseline manifest, in the corrected freeze and recompute all counts, sizes, hashes and aggregates.

### TOS-S2-004 — MEDIUM — Secret/evidence scanning has material coverage gaps

**Affected controls**

- `tooling/ci/scan-source-secrets.mjs`
- `tooling/ci/scan-browser-bundles.mjs`
- `tooling/ci/capture-stage-2-evidence.mjs`
- frozen documentation and evidence under `docs/`

**Evidence**

The source scanner omits `docs/`, `AGENTS.md`, `IDEA.md` and Markdown generally, despite the frozen candidate and generated evidence containing a substantial documentation corpus. A synthetic, non-secret canary assigned to a generic identifier such as `secret` also passed both the source and browser-bundle scanners in a disposable copy.

No real credential or secret was found in the frozen candidate. This finding concerns the claimed preventive control and its evidence scope.

**Concrete failure scenario**

A credential is pasted into an implementation/review Markdown document, generated evidence, or a source/bundle assignment using an unrecognised but ordinary secret identifier. Both reported scan gates stay green.

**Consequence**

The PASS evidence does not prove the repository-wide “no secrets in source, config, evidence or bundles” invariant over all frozen bytes.

**Required correction**

- Scan the full frozen manifest, including Markdown and evidence, with explicit bounded allowlists.
- Expand assigned-secret identifiers and provider/signature coverage.
- Add entropy-oriented detection appropriate to synthetic fixtures.
- Add negative canaries for source, generated evidence and built bundles.
- Keep emitted reports redacted and fail closed before writing unsafe evidence.

### TOS-S2-005 — MEDIUM — Manifest permits colliding API ports

**Affected controls**

- `packages/config/src/instance-manifest.ts`
- `packages/config/test/instance-manifest.test.ts`
- `deploy/manifests/schema/instance-manifest.schema.json`

**Evidence**

A disposable runtime-parser probe confirmed that a manifest with `adminApiPort === portalApiPort` is accepted.

**Concrete failure scenario**

The separately composed Admin and Portal APIs are configured to bind the same loopback address and port. One composition root cannot start, even though the manifest passed validation.

**Consequence**

The authoritative configuration parser accepts a manifest that cannot run the required pair of API processes simultaneously.

**Required correction**

Require distinct Admin and Portal API ports and add parser, schema-parity and process-start negative tests.

### TOS-S2-006 — LOW — Generated JSON Schema is weaker than the runtime contract

**Affected controls**

- `packages/config/src/instance-manifest.ts`
- `tooling/ci/write-instance-manifest-schema.ts`
- `deploy/manifests/schema/instance-manifest.schema.json`

**Evidence**

The generated JSON Schema accepts a manifest where Admin and Portal hosts are equal and the host allowlist repeats that host for both surfaces. The runtime Zod parser rejects the same shape through cross-field refinements. The schema drift gate proves generator/file equality, not semantic parity with runtime refinements.

**Consequence**

A downstream editor or deployment validator can return a false green if it treats the published JSON Schema as the complete contract.

**Required correction**

Encode the cross-field invariants in a downstream validator used at every trust boundary, or explicitly label the JSON Schema as structural-only and require the authoritative parser. Add parity fixtures that must produce equivalent decisions.

### TOS-S2-007 — LOW — Rejected-technology scanner is not a semantic dependency/import verifier

**Affected controls**

- `tooling/ci/verify-rejected-technologies.mjs`
- workspace manifests and `pnpm-lock.yaml`

**Evidence**

Independent adjudication did **not** reproduce the claim that ordinary static imports such as `from "@prisma/client"`, `from "next/link"`, or `from "ioredis"` bypass the current regex; those forms are detected. However, the source check is regex-based and does not semantically cover every CommonJS, computed-specifier or alias target form. Manifest checks are primarily key-based rather than package-specifier-aware.

Current linting, the current lockfile and the absence of forbidden runtime dependencies reduce the immediate exploitability. They do not make the control complete as the dependency graph evolves.

**Consequence**

A noncanonical source/dependency declaration may evade the intended rejected-technology gate, particularly once more runtime dependencies become available transitively.

**Required correction**

Parse source module specifiers and package-manager dependency specifications semantically, including `import`, re-export, dynamic import, CommonJS/createRequire and npm aliases. Retain synthetic negative fixtures for every supported module form.

## 6. Category B — legitimate later-stage gates

The following are mandatory later gates but are not reclassified here as Stage 2 implementation defects:

1. exact-host enforcement and rejection at Caddy and both APIs, including canonical `Host`/forwarded-host handling;
2. actual PostgreSQL Admin/Portal/Worker role creation and privilege-denial proofs—credential-reference labels alone cannot prove role separation;
3. two Better Auth realm integrations with distinct cookies, tables, routes and secrets;
4. migration-chain, database constraint and privilege integration tests;
5. runtime publication, grant, outbox/job, file and authorization controls;
6. CT 200 deployment, exact-artifact, restore and operational evidence only when the accepted later stage authorizes those actions.

In particular, the absence of runtime host middleware in the Stage 2 health-only composition roots is not treated as a Stage 2 BLOCKER: the Stage 2 milestone establishes the configuration contract and executable skeleton, while runtime edge/API enforcement remains an explicit later gate. Advancing must not be interpreted as waiving that gate.

## 7. Rejected or bounded candidate findings

- **Freeze corruption:** rejected; all 203 rows matched.
- **Evidence-index corruption:** rejected; all 19 indexed artifacts matched.
- **CT 200 mutation:** not evidenced.
- **Stage 3 implementation drift:** not evidenced.
- **Normal static rejected-technology imports bypass the regex:** not reproduced; only the narrower semantic-coverage weakness in TOS-S2-007 is retained.
- **Current lockfile executed an unapproved lifecycle script:** not evidenced; the policy verifier's structural weakness is retained instead.
- **Runtime host enforcement must already exist in Stage 2:** classified as a later gate rather than a frozen-candidate blocker.

## 8. Closure decision

The frozen bytes are intact, the evidence bundle is internally consistent, the five executable roots are real, and much of the final validation reproduced successfully. Nevertheless, TOS-S2-001 proves that the architecture gate can certify direct vendor/framework leakage into core code. That is a material defect in the principal foundation Stage 2 was required to establish. The lifecycle policy, self-contained freeze and scan/config findings add further correction work.

Stage 2 may be reconsidered only after:

1. all Category A corrections are made without beginning Stage 3;
2. the protected Phase 0 baseline remains unchanged;
3. the complete final validation and fresh-store install are rerun;
4. evidence and validation artifacts are regenerated from final bytes;
5. a new exact, self-contained candidate freeze is created; and
6. the corrected freeze receives a new independent review.

NO-GO
