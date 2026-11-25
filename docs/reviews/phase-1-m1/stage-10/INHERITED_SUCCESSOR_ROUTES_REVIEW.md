# Stage 10 inherited successor routes — scoped review

**Decision: GO for the three route mechanisms only.** This is not canonical CI, current-candidate gate approval, privacy acceptance, build readiness, or Stage 10 operational GO. The routes fail closed on candidate/artifact qualification, do not rewrite historical checks, and retain post-run drift checks. No Stage 10 gate status is upgraded by this review.

## Scope and reviewed bytes

Read-only review of the migrator, Stage 8 artifact, and source-scope adapters, their targeted tests, `packaged-verifier.mjs`, `gate-process.mjs`, `gates.mjs`, and `docs/implementation/M1_STAGE_10_INHERITED_GATE_COVERAGE.md`. SHA-256 of reviewed route/tooling and coverage-doc bytes:

| File | SHA-256 |
|---|---|
| `tooling/ci/stage-10/inherited-compatibility-adapter.mjs` | `e0d4abb3ee88dfb95e0182cbc68a4fcd6a63a8144ad911da8eacd8c68d19f741` |
| `tooling/ci/stage-10/packaged-migrator-regression.mjs` | `0abaa3d4aa146cf455bd046568a8d8e1279d0115223e902da2fd55f7bf092599` |
| `tooling/ci/stage-10/stage8-artifact-regression.mjs` | `c1c5c214ccd08e2eebb5fe235b640f8a48002f96da368a50ca670606f823ff84` |
| `tooling/ci/stage-10/source-scope.mjs` | `09dcfcd5967501cc1c7b77669227662ed10c9888b720d7259688b52ee7ef4918` |
| `tooling/ci/stage-10/packaged-verifier.mjs` | `65cd7d54b02943af9c43e441ccd78988d3b644c56be618fa51404830ee22c6b3` |
| `tooling/ci/stage-10/gate-process.mjs` | `4aae3ea2ba12590ca7bfa7cbe3686fc06f91e743503a61ccd646a0a2815419d3` |
| `tooling/ci/stage-10/gates.mjs` | `75970cdc8f58a998e4d791130a826edcc72a0336acf884ef8a781dd3b9a2bb80` |
| `docs/implementation/M1_STAGE_10_INHERITED_GATE_COVERAGE.md` | `849bfd686f3417b04eb847366b589f12c9f7e1fb6b14a360b1858daab7b4eb57` |

## Route findings

- **Migrator — scoped GO.** `inherited-compatibility-adapter.mjs:95–119,120–135` qualifies frozen inputs, predecessor baseline, migration chain, consumed build claim, and extracted artifact before dispatch; it checks candidate inputs again after execution (`:126–129`). `packaged-migrator-regression.mjs:10–69` checks package identity/entrypoint/dependency families, exact 16-file manifest and bytes, module-relative resolver paths, actual packaged migration verifier, and symlink containment without DB mutation. Focused inverse tests passed (5 negative probes, `test-packaged-migrator-regression.mjs`); adapter fail-closed/dispatch guards passed. Residual test gap (LOW): those five probes do not construct an escaping symlink to exercise the containment rejection at `packaged-migrator-regression.mjs:35–48`; the real artifact's reported `linksContained: true` is positive-path evidence, not that inverse. Add a focused escape-link rejection when extending qualification; not a route-mechanism blocker on the reviewed bytes.

- **Stage 8 artifact — scoped GO.** `stage8-artifact-regression.mjs:9–20,41–72` pins the accepted historical test source and anchors the two deliberate adaptations; `:83–117` runs the generated suite and asserts exact totals (16 pass, zero skip/cancel). Candidate adapter qualification and post-run drift check are at `inherited-compatibility-adapter.mjs:137–157`. The supplied run record reports 16/16, 14 unchanged, 2 translated, 0 skipped on mutable `travelos-stage10-gen12-c11e3dd7`; the test also verifies it binds candidate inputs before executing the inherited obligations. The documented status explicitly remains noncanonical and non-approval. I did not rerun the long artifact suite.

- **Source scope — scoped GO.** `source-scope.mjs:53–67` binds the Stage 10 branch, accepted predecessor tree, inherited baseline, current-source capture, and exact content equality. `:23–50` rejects duplicate/invalid/traversal/local-state paths, missing inherited paths, and unapproved additions. Its three `.hermes` exclusions are enumerated (`:8–12`) and are still covered by the all-predecessor-byte baseline check; they do not silently reduce protected history. The mutable execution record reports 2,659 inherited source files, 171 allowed-area additions, and all 2,662 predecessor files baseline-matched. The historical `5609…` pre-closure HEAD check is correctly not reused: the accepted Stage 7 closure is `a57789…`, and its own baseline, predecessor and inverse tests passed; the obsolete source wrapper rejects that accepted closure. The current replacement checks the actual accepted ref and source, rather than making the historical wrapper pass by rewriting history. Eight focused source-scope tests passed.

## Verification and boundaries

Executed read-only focused commands: `node tooling/ci/stage-10/test-packaged-migrator-regression.mjs`; `node --test tooling/ci/stage-10/test-source-scope.mjs` (8/8); `node tooling/ci/stage-10/test-inherited-compatibility-adapter.mjs`; and `node tooling/ci/stage-10/test-gate-process.mjs` (3/3). All passed. The latest mutable-package state identifies `travelos-stage10-gen12-c11e3dd7` with input digest `c11e3dd7…`; the retained migrator regression summary names a different mutable artifact `travelos-stage10-gen12-2641c43e`. Accordingly, that historical positive migrator receipt is not evidence that its earlier run used the latest mutable artifact. This does not invalidate the route code: its gate prequalifies the exact candidate artifact before the migrator regression. No claim is made here that all three positive executions share one artifact ID or that a canonical Stage 10 run occurred.

The installer compatibility detail is correctly fail-closed: `packaged-verifier.mjs:37–56` requires structured inputs and mandatory independent pins, so the old root-string verifier call remains unauthorized; import compatibility alone does not authorize installation. `gates.mjs:73–85` and the coverage document preserve noncanonical/pending statuses. No source edits, fixtures, artifact generation, network, key, or CT actions were performed.
