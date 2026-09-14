# TravelOS Phase 1 M1 — Stage 2 review corrections

Status: **FINAL DEPENDENCY-UNIVERSE CORRECTION**

This matrix records author corrections against `STAGE_2_INDEPENDENT_REVIEW.md` and the later focused independent closure challenges. TOS-S2-002 through TOS-S2-006 remain independently closed. TOS-S2-001 and TOS-S2-007 remain author-corrected but pending independent closure: the first correction made compiler-resolved production-source discovery complete, while the FREEZE_2 review then showed that dependency-request discovery was not yet complete. This author correction does not self-close either finding, alter a predecessor freeze, authorize Stage 3, or constitute final independent closure.

## TOS-S2-001

- **Original severity:** HIGH
- **Category:** A
- **Reviewer claim:** The architecture gate permitted direct vendor/framework imports, first-edge framework leakage through another workspace package, computed module specifiers, undeclared dependencies, and Admin/Portal contract inversion while reporting a green graph.
- **Reproduction/adjudication:** CONFIRMED. The source-discovery correction remains valid, but the FREEZE_2 independent review demonstrated compiler-included and policy-inspected files whose dependencies escaped the former module-request visitor: implicit `react/jsx-runtime`, per-file `@jsxImportSource`, aliased `require`, external module augmentation, and triple-reference `types`. Aliased `require.resolve` and a derived `createRequire()` loader are equivalent fail-closed regression cases.
- **Root cause:** Compiler-source coverage was complete, but dependency-request coverage was incomplete. The architecture gate treated module specifiers found by its AST visitor as the dependency universe instead of proving that compiler/module, type/declaration, runtime-loader, implicit compiler-generated, and unsupported loading forms were all accounted for.
- **Implemented correction:** Preserved `production-source-discovery.mjs` and added one repository-owned normalized dependency universe. It uses the TypeScript Program and TypeScript resolution APIs for compiler-known module/type references, AST semantics for direct loaders and declarations, explicit JSX-runtime and `jsxImportSource` modeling, type-reference and external-augmentation modeling, and fail-closed `architecture/unsupported-module-loader-alias` findings for aliases or derived values of `require`, `require.resolve`, and `createRequire()` loaders. Both package-boundary and rejected-technology policy consume the same normalized production universe. Static `.css` imports are the only narrowly classified non-TypeScript asset form: they remain policy-visible and are allowed only through the owning unit’s package capability; other unresolved dependencies are not ignored.
- **Supported forms:** import, export-from, import type, import-equals, dynamic import, direct `require`, direct `require.resolve`, direct `createRequire` loader calls/resolution, automatic JSX runtime, `jsxImportSource`, type/path references, external module augmentation, and static CSS asset imports. Unexplained compiler references and unsupported loader constructs fail the mandatory architecture gate.
- **Focused regression tests:** `pnpm run verify:dependency-universe`; `pnpm run architecture:check`; original nine layered-boundary fixtures; compiler-participating `.mts`, `.cts`, and `.d.mts` probes; implicit JSX runtime; `jsxImportSource`; aliased loader; external augmentation; triple-reference; and safe UI/auth/declaration probes.
- **Files affected:** `tooling/architecture/production-source-discovery.mjs`, `tooling/architecture/dependency-universe.mjs`, `tooling/architecture/dependency-universe-fixture-suite.mjs`, `tooling/architecture/verify-dependency-universe.mjs`, `tooling/architecture/package-boundary-policy.mjs`, `tooling/architecture/check.mjs`, `tooling/architecture/source-discovery-fixture-suite.mjs`, `tooling/architecture/dependency-cruiser.cjs`, `tooling/ci/rejected-technology-policy.mjs`, `tooling/ci/test-rejected-technologies.mjs`, `tooling/ci/capture-stage-2-evidence.mjs`, `package.json`.
- **Focused final result:** PASS — 35 compiler-resolved and 35 policy-inspected production files; zero uncovered/unsupported sources; 54 compiler-known and 54 normalized policy dependencies; zero unexplained references, unsupported real-source constructs, unresolved normalized dependencies, cycles, or production violations; exactly two policy-visible CSS asset imports; 9/9 original architecture fixtures, 3/3 malicious source-form fixtures, and 8/8 new dependency-universe attacks rejected; 3/3 safe source-form and 4/4 safe dependency-universe cases accepted with zero applicable compiler diagnostics.
- **Status:** **CORRECTED — PENDING INDEPENDENT CLOSURE**

## TOS-S2-002

- **Original severity:** MEDIUM
- **Category:** A
- **Reviewer claim:** Lifecycle and release-age policy was regex-checked and evidence could hardcode an esbuild-only conclusion without proving the exact effective pnpm policy or a malicious lifecycle denial.
- **Reproduction/adjudication:** CONFIRMED as an enforcement defect. No unapproved lifecycle execution was found in the historical candidate, but a broadened `allowBuilds` map was not rejected by the former verifier.
- **Root cause:** Policy conclusions were inferred from YAML text and retained install output instead of exact structured effective configuration plus an executable denial probe.
- **Implemented correction:** Structurally inspects effective pnpm policy and requires `minimumReleaseAge = 1440`, exact lodash override `4.18.1`, empty release-age exclusions, and exact `allowBuilds = { esbuild: true }`; rejects broader policy; evaluates cache/no-output and lifecycle evidence fail-closed; exercises a network-free local package with a synthetic lifecycle marker and requires it to remain blocked/ignored.
- **Focused regression tests:** `pnpm run verify:pins`; `pnpm run test:lifecycle-policy`; `node tooling/ci/capture-stage-2-evidence.mjs --self-test-install-lifecycle-policy`.
- **Files affected:** `tooling/ci/verify-pins.mjs`, `tooling/ci/test-lifecycle-policy.mjs`, `tooling/ci/install.sh`, `tooling/ci/capture-stage-2-evidence.mjs`, `pnpm-workspace.yaml`.
- **Evidence expected in final regression:** Exact effective-policy report; accepted cache/esbuild cases; rejected missing-proof, unapproved, ignored-build, and broadened-policy cases; disposable lifecycle marker absent.
- **Status:** **CLOSED — INDEPENDENT CLOSURE PRESERVED**

## TOS-S2-003

- **Original severity:** MEDIUM
- **Category:** A
- **Reviewer claim:** The historical 203-entry freeze could not independently execute aggregate verification because the accepted Phase 0 baseline manifest was referenced but omitted as a row.
- **Reproduction/adjudication:** CONFIRMED. The exact historical candidate needed one mutable-workspace input outside its manifest.
- **Root cause:** Freeze construction used an implementation/evidence inventory rather than a requirement-checked collector for every review and executable verification input.
- **Implemented correction:** Added a deterministic future-freeze input collector that cryptographically binds the Phase 0 baseline reference and all 40 protected rows, approved M1 plan, corrected Stage 1 inputs/evidence, repository/toolchain/manifests/configuration, 14 workspace manifests, all TypeScript/test/lint configuration, architecture tooling/fixtures, CI/scanners, workflows, five composition roots, Stage 2 package source/tests, retained evidence/index, and Stage 2 review/validation/correction history. It emits sorted path/byte/SHA-256 rows and an aggregate without creating the final freeze. Its explicit `PRE_FINAL` mode may omit only the final evidence index and corrected validation report, is marked `finalFreezeEligible: false`, and the default `FINAL_FREEZE` mode rejects either omission.
- **Focused regression tests:** `node tooling/ci/test-stage-2-freeze-inputs.mjs`; `node tooling/ci/collect-stage-2-freeze-inputs.mjs --pre-final --summary`.
- **Files affected:** `tooling/ci/stage-2-freeze-inputs.mjs`, `tooling/ci/collect-stage-2-freeze-inputs.mjs`, `tooling/ci/test-stage-2-freeze-inputs.mjs`, `tooling/ci/scan-source-secrets.mjs`.
- **Evidence expected in final regression:** Deterministic input count and aggregate; all completeness requirements green; explicit omission of `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md` rejected by the intended requirement; pre-final output ineligible for a freeze; final mode requiring both the final evidence index and corrected validation report.
- **Status:** **CLOSED — INDEPENDENT CLOSURE PRESERVED**

## TOS-S2-004

- **Original severity:** MEDIUM
- **Category:** A
- **Reviewer claim:** Secret/PII scanners omitted review Markdown and evidence and missed ordinary assigned-secret forms; browser and generated-evidence canaries were incomplete.
- **Reproduction/adjudication:** CONFIRMED as a coverage/control defect. No real credential was found in the historical freeze.
- **Root cause:** Separate path-limited regex scripts scanned conventional implementation roots rather than the exact future freeze-input set and shared structural rules.
- **Implemented correction:** Added one redacting scanner engine covering assigned sensitive identifiers, entropy-qualified assignments, Bearer authorization material, private-key headers, provider signatures, credential-bearing URL userinfo/query parameters, and email-like PII. Source scanning consumes the deterministic freeze-input set, including tooling, workflows, manifests/examples, review Markdown and retained evidence. Browser scanning reuses the same rules plus browser-only database/credential-reference leakage checks. Synthetic sentinels are assembled at test runtime; allowlisting is exact path/rule scoped.
- **Focused regression tests:** `node tooling/ci/test-sensitive-data-scanner.mjs`; `node tooling/ci/scan-source-secrets.mjs`; browser-scope adversarial fixture in the scanner suite. Built-bundle positive scanning remains part of the later full regression after build.
- **Files affected:** `tooling/ci/sensitive-data-scanner.mjs`, `tooling/ci/test-sensitive-data-scanner.mjs`, `tooling/ci/scan-source-secrets.mjs`, `tooling/ci/scan-browser-bundles.mjs`, `tooling/ci/capture-stage-2-evidence.mjs`.
- **Evidence expected in final regression:** All synthetic source/evidence/browser sentinels rejected by named rules; exact allowlist probe; full freeze-input scope counts including evidence; generated browser assets green with zero values emitted.
- **Status:** **CLOSED — INDEPENDENT CLOSURE PRESERVED**

## TOS-S2-005

- **Original severity:** MEDIUM
- **Category:** A
- **Reviewer claim:** One shared bind address plus equal Admin/Portal API ports was accepted even though both processes could not listen concurrently.
- **Reproduction/adjudication:** CONFIRMED for the historical model. The accepted correction invariant is exact endpoint inequality, not unconditional numeric-port inequality.
- **Root cause:** Listener identity was split across one shared host and two unconstrained port fields with no cross-field endpoint validation.
- **Implemented correction:** The manifest now has independent `runtime.listeners.adminApi` and `runtime.listeners.portalApi` host/port objects. Hosts are explicit IPv4 loopback addresses in `127.0.0.0/8`; ports are `1024..65535`; Zod rejects an identical host+port pair. Equal numeric ports are accepted on clearly distinct explicit loopback addresses. Each API composition root consumes only its own listener. Smoke mode keeps the configured host but requests ephemeral port `0` locally.
- **Focused regression tests:** focused `packages/config/test/instance-manifest.test.ts` listener cases and composition-root typecheck.
- **Files affected:** `packages/config/src/instance-manifest.ts`, `packages/config/test/instance-manifest.test.ts`, `deploy/manifests/development.example.json`, `apps/admin-api/src/main.ts`, `apps/portal-api/src/main.ts`, `docs/implementation/M1_STAGE_2_CONFIGURATION_CONTRACT.md`.
- **Evidence expected in final regression:** Different ports on `127.0.0.1` accepted; identical `127.0.0.1` endpoints rejected; equal ports on `127.0.0.1`/`127.0.0.2` accepted; both composition roots build and perform ephemeral loopback smoke tests.
- **Status:** **CLOSED — INDEPENDENT CLOSURE PRESERVED**

## TOS-S2-006

- **Original severity:** LOW
- **Category:** A
- **Reviewer claim:** Generated JSON Schema was structurally weaker than runtime Zod refinements and could be misrepresented as the complete semantic contract.
- **Reproduction/adjudication:** CONFIRMED. Generator/file equality did not prove runtime cross-field semantics.
- **Root cause:** Direct `z.toJSONSchema` output was generated without integrating the authored structural-plus-runtime-refinement contract or a machine-readable invariant split.
- **Implemented correction:** Exported and integrated `instance-manifest-json-schema.ts`; added a machine-readable invariant registry separating directly representable constraints from runtime-only sibling/set comparisons; added exact host-surface cardinality to Draft 2020-12; retained strict Zod validation; labelled the schema structural with declared runtime refinements; generator now uses the intended document factory.
- **Focused regression tests:** focused `packages/config/test/instance-manifest-json-schema.test.ts`; `pnpm run config:schema:check`; changed-file typecheck.
- **Files affected:** `packages/config/src/instance-manifest-json-schema.ts`, `packages/config/src/instance-manifest-invariants.ts`, `packages/config/src/instance-manifest.ts`, `packages/config/src/index.ts`, `packages/config/test/instance-manifest-json-schema.test.ts`, `tooling/ci/write-instance-manifest-schema.ts`, `deploy/manifests/schema/instance-manifest.schema.json`, `docs/implementation/M1_STAGE_2_CONFIGURATION_CONTRACT.md`.
- **Evidence expected in final regression:** Valid manifest accepted by both; representable unknown-key/type/host/port/cardinality defects rejected by both; collision and host/allowlist relationship listed and rejected at runtime; generated schema drift green; no semantic-equivalence claim.
- **Status:** **CLOSED — INDEPENDENT CLOSURE PRESERVED**

## TOS-S2-007

- **Original severity:** LOW
- **Category:** A
- **Reviewer claim:** Rejected-technology checks were raw-text/key based and not authoritative over all supported module forms or dependency aliases.
- **Reproduction/adjudication:** PARTIALLY CONFIRMED. The ordinary static-import claim remains disproved. FREEZE_2 nevertheless showed that rejected technology could be referenced through `@jsxImportSource`, external module augmentation, or triple-reference `types` without reaching the former semantic request collector. An aliased runtime loader could also conceal its target, although architecture—not rejected-tech dataflow inference—is the mandatory fail-closed authority for that unsupported construct.
- **Root cause:** Source coverage was complete, but the rejected-technology scanner still depended on the same incomplete dependency-request universe as TOS-S2-001.
- **Implemented correction:** Production rejected-technology enforcement consumes the same compiler-cross-checked normalized dependency universe as architecture enforcement. It semantically classifies ordinary imports/re-exports/type imports/import-equals, direct CommonJS/dynamic/`createRequire` forms, JSX import sources, type references, and external augmentations. Manifest `npm:` aliases remain rejected; accepted Better Auth transitive metadata remains disclosure rather than false direct adoption. Unknown loader aliases need not be guessed because the mandatory architecture gate rejects them before a build can pass.
- **Focused regression tests:** `pnpm run test:rejected-technologies`; `pnpm run verify:rejected-technologies`; shared dependency-universe fixture suite; compiler-participating `.mts`/`.cts` probes; `jsxImportSource`, augmentation, and triple-reference semantic probes; loader-alias architecture rejection; original nine semantic fixtures; npm-alias and transitive-disclosure assertions.
- **Files affected:** `tooling/architecture/production-source-discovery.mjs`, `tooling/architecture/dependency-universe.mjs`, `tooling/architecture/dependency-universe-fixture-suite.mjs`, `tooling/architecture/source-discovery-fixture-suite.mjs`, `tooling/architecture/package-boundary-policy.mjs`, `tooling/ci/rejected-technology-policy.mjs`, `tooling/ci/test-rejected-technologies.mjs`, `tooling/ci/verify-rejected-technologies.mjs`, `tooling/ci/capture-stage-2-evidence.mjs`.
- **Focused final result:** PASS — zero repository direct-adoption/import findings; 9/9 original semantic fixtures and all three new semantic dependency forms rejected; `.mts`/`.cts` malicious cases rejected and safe cases accepted; three loader-alias forms blocked by mandatory architecture; npm alias rejection and Better Auth transitive disclosure preserved.
- **Status:** **CORRECTED — PENDING INDEPENDENT CLOSURE**

## Author-discovered regression defect — Node bootstrap archive checksum

- **Defect:** The first final-regression bootstrap attempt stopped because `tooling/ci/bootstrap-toolchain.sh` contained an incorrect SHA-256 for the exact Node.js `24.19.0` Linux x64 archive.
- **Root cause:** The Stage 2 bootstrap script diverged from the immutable Stage 1-qualified archive provenance even though the Node version itself remained pinned correctly.
- **Correction:** The bootstrap checksum was restored to `14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647`; the bootstrap remains pinned to `node-v24.19.0-linux-x64.tar.xz` and must fail before extraction or execution if that digest does not match.
- **Stage 1 provenance:** `docs/evidence/phase-1-m1/stage-1/toolchain-package-provenance.json` records the same expected/actual SHA-256 and official SHASUMS row; `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX_CORRECTED.md` binds the qualified Node archive to that evidence.
- **Regression proof required:** Run the repository-owned bootstrap path against the exact accepted archive; verify the archive SHA-256 before execution; require Node `24.19.0`, Corepack `0.35.0`, and pnpm `11.21.0`; then complete the clean frozen install with an unchanged lockfile.
- **Status:** **CORRECTED — PENDING FINAL REGRESSION**

## Author-discovered final-evidence defect — correction artifact count

- **Defect:** The final evidence generator built valid indexed rows with `path` but attempted to identify correction artifacts through a discarded internal `fileName` property. Final generation would therefore abort at the mandatory 19-original-plus-7-correction count assertion after writing the artifacts.
- **Root cause:** The index-row projection intentionally omitted the internal artifact file name, but the later completeness assertion and terminal summary still referenced the pre-projection shape.
- **Correction:** Correction artifacts are now identified from the basename of each indexed repository-relative path. The public evidence-index row shape remains unchanged.
- **Regression proof required:** Run the final evidence generator and require exactly 26 indexed artifacts, exactly 7 correction artifacts, successful read-back verification of every indexed byte count and SHA-256, and a final indexed-evidence scan with zero findings.
- **Status:** **CORRECTED — PENDING FINAL EVIDENCE**
