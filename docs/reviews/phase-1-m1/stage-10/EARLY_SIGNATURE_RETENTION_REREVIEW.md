# Stage 10 — early signature and evidence-retention re-review

**Scope:** mutable local slices only; not Stage 10 or production acceptance. Independent reviewer `sa-0-0b8dda94`, delegation `deleg_9a396207`; no tests or deployment performed by reviewer. Report recovered from the original session. Reviewed SHA-256: `stage10-signature.mjs` `f271563a9578cc5c85b80eb66fa4da8d24e8a1a9aa9249529401c685ca20879a`; `stage10-evidence-retention.mjs` `f72874b6dbff7bb287cf0ceba960676ac68617678f77836349e23ece3d36a284`.

## Findings

- **BLOCKER S10-SIG-001, OPEN:** signature verifier has no production activation caller; the Stage 9 activation path does not invoke it. A unit test does not prove a fail-closed real activation chain.
- **HIGH S10-SIG-002, OPEN:** independently provisioned trust pins and trusted caller/host boundary are not demonstrated. Fixed root-owned policy is useful but test-created policy cannot prove independent provisioning; numeric root alone does not establish host-root identity.
- **HIGH S10-TEST-001, OPEN:** signature tests modify `/etc/travelos`; current UID-map and mountinfo checks do not sufficiently guarantee safe isolation and cleanup. Do not run on a host `/etc`.
- **MEDIUM S10-SIG-003, OPEN:** root-private snapshot is not intrinsically immutable; source mutation test does not demonstrate protection against a writer to the snapshot during verification or consumption.
- **MEDIUM S10-RET-001, OPEN:** check-then-rename and advisory lock do not prove no-clobber against a non-cooperating same-UID process racing an empty destination.
- **MEDIUM S10-RET-002, OPEN:** expected receipt hash is independent only if supplied by a separately protected trusted source; the synthetic test derives its pin from its own receipt and proves no custody boundary.
- **MEDIUM S10-RET-003, OPEN:** intermediate directory checks followed by pathname opens admit TOCTOU; `O_NOFOLLOW` protects only the final component.
- **MEDIUM S10-RET-004, OPEN:** scanner checks finite patterns and is not sanitization or independent privacy review. Raw bytes are explicitly marked scanner-only, and need review before canonical publication.
- **MEDIUM S10-SIG-004, OPEN:** `--insecure-ignore-tlog` verifies no transparency proof; independently protected receipts or verified proofs and explicit limitation remain necessary.

These findings remain open pending corrections, real qualification, and independent adjudication. Existing CT200 broad sudo and activation helper must not be used to bypass the guard.
