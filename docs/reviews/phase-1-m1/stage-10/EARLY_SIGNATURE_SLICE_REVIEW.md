# Stage 10 — early signature slice security review

**Scope:** mutable local implementation slice only; no Stage 10 decision. Reviewer `sa-0-cb1ece50`, delegation `deleg_7322c9ff`. Review was read-only; no tests or deployment were performed by reviewer.

**Verdict:** not safe as an activation guard.

- **S10-SIG-001 BLOCKER — activation enforcement absent (integration gap).** `tooling/deployment/stage10-signature.mjs:55–56`. The real CT200 root helper still accepts a sealed-directory ownership check before flipping the release pointer, and broad sudo access can bypass an optional verifier. Require a constrained, fail-closed real activation chain before extraction, migration, or pointer change; independently test it.
- **S10-SIG-002 HIGH — caller-provided trust is not independently pinned.** `tooling/deployment/stage10-signature.mjs:57–72,77–81`. A caller can supply a matching attacker-selected archive, key, binary and policy. A protected, versioned, independently controlled trust source and trusted caller boundary are mandatory.
- **S10-SIG-003 MEDIUM — pre/post hashing does not prevent a concurrent change-and-restore race.** `tooling/deployment/stage10-signature.mjs:75–85`. Existing writable handles or writers can modify and restore data between hashes while Cosign reads. No-follow and single-link checks alone do not prevent that. Require an independently protected immutable/private snapshot consumed by both verifier and deployment, and concurrent-mutation qualification. Do not use the existing verifier to authorize activation.
- **S10-SIG-004 MEDIUM — offline transparency tradeoff.** `tooling/deployment/stage10-signature.mjs:34–40`. `--insecure-ignore-tlog` provides no Rekor inclusion/consistency or independent signing-time evidence. Clearly state that limitation and require independently protected receipts or verified log proofs; never claim transparency verification.

Archive extraction safety, custody, revocation/recovery, retention, real activation and independent pinned-trust distribution remain explicitly unimplemented gates, not passing controls. Test coverage is sequential; it does not prove concurrent safety or independently trusted policy. Current test code does not establish any deployment or production assurance.
