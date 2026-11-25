# Stage 10 — independent mutable signing boundary review

**Decision:** NO-GO for the local slice; not a Stage 10 decision. Reviewer `sa-0-96b681c8`, delegation `deleg_568daa5d`. No files modified, tests run, or CT200 access.

Reviewed SHA-256: `tooling/deployment/stage10-signature.mjs` `d29dcb5fcec8bd4ae15a579e022bca038701a8f0d5835c0a6eec65a6d421d6f1`; `tooling/deployment/stage10-activation.mjs` `d90def884066b6c09e9595ec7f72a581d454211dbdc148f1f49ff43a21971585`.

- **S10-TEST-001 MEDIUM — OPEN:** `test-stage10-signature.mjs:22–45` trusts environment-provided host namespace/device claims. A caller can forge these; if root has a one-entry UID map and `/etc` and `/opt` are tmpfs mounts, the checks can pass without the launcher's fresh mounts, risking writes to host `/etc/travelos`. The launcher creates private mounts, but the test does not authenticate that fact.
- **S10-ACT-DURABILITY-001 MEDIUM — OPEN:** `stage10-activation.mjs:205–207,237–243` extracts the release then switches and syncs only `/opt/travelos`. It does not fsync extracted files/directories or the releases directory before the pointer switch. Power loss can leave a durable pointer to nondurable content.
- **S10-SIG-001 BLOCKER — OPEN for host:** no installed, least-privilege invocation; legacy Stage 9 activation route and broad-sudo bypass remain. Local CLI alone does not prove every host path enforces signatures.
- **S10-SIG-002 HIGH — OPEN:** root ownership checks do not establish independent policy provisioning, host-root identity, key custody or an authorized restricted privilege entry point.
- **S10-SIG-003 MEDIUM — locally addressed in source, not independently test-qualified:** verification and extraction share a sealed descriptor; host kernel/proc/interpreter qualification remains pending.
- **S10-SIG-004 MEDIUM — OPEN for acceptance:** output acknowledges absent transparency proofs; protected offline-acceptance evidence or verified proofs remain required.

Correct findings and obtain fresh independent review against exact changed bytes. This document is not approval to activate CT200.
