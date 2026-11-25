# Stage 10 local pipeline/package review

Reviewer: `sa-0-6d1cbb4d`, delegation `deleg_eefc43ef`. Read-only independent code review; no canonical CI, build, candidate claim or remote operation performed by reviewer. This is not a final candidate decision.

## Findings

1. Canonical execution remains unimplemented: `run-canonical-ci.mjs` refuses before claims, and pending gates are not executable qualification. Missing implementation is next work, not an independently executed Stage 10 NO-GO.
2. Current extracted qualification performs package integrity, dependency resolution, syntax and service-path inspection, not service startup/configuration/database acceptance. Preserve this scope distinction.
3. Synthetic production-package and service-path fixtures do not prove actual offline install, compile and pnpm deploy output. A mutable real-package rehearsal is required before claiming that boundary.
4. Build toolchain selection is vulnerable to PATH shadowing: both `readToolchain` and the production recipe selected `corepack` via inherited PATH. Authenticate a fixed executable chain and exercise an adversarial shim regression before enabling the recipe.

## Parent adjudication and correction work

Alex verified the relevant source and reproduced finding 4 with a PATH-prepended Corepack shim that emitted the expected versions and wrote an execution marker. The regression failed because the marker existed. Mutable correction selects fixed build-host Node/Corepack paths, checks the two executable Corepack implementation file digests, invokes Corepack explicitly through that Node, and supplies a constrained child environment. The regression subsequently passed without executing the shim. No claim of independent re-review or hostile same-UID build-host isolation follows: the build UID and its primary group remain trusted, and pins are local source policy, not third-party provenance.

Findings 1–3 remain integration/qualification work. Next step: a clearly labelled mutable real production-recipe/package rehearsal, retained outside candidate state, followed by implementation of representative runtime qualification. Do not consume canonical CI, mark gates reviewed, remove the readiness brake or promote the rehearsal archive.
