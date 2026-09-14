# TravelOS Phase 1 M1 — Stage 1 Candidate Freeze

- **Frozen at:** 2026-08-14T15:01:26+01:00
- **Purpose:** freeze the exact Stage 1 qualification and decision bytes submitted for independent Stage 1 review
- **Supersedes as candidate:** none; this is the first Stage 1 candidate freeze
- **Accepted upstream baseline:** `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md`
- **Authoritative execution plan:** `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md`
- **Entry count:** 6
- **Status at freeze:** validation PASS; ready for independent review; independent closure not yet performed

## 1. Exact SHA-256 manifest

| Path | SHA-256 |
|---|---|
| `AGENTS.md` | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md` | `bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb` |
| `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md` | `210ab56b4d104b9ba8c5f825bd370c3c9056be172f8a2f6db00704ca91a58f71` |
| `docs/implementation/M1_STAGE_1_CT200_BASELINE.md` | `b605ae5dbe2082e7a1976f90f517c6cceecebedaffdc9305bc07f9b9f202afbc` |
| `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX.md` | `9ab1b68ce435033f2d5c6cf3e9cc15c27b0ea12867d0473b4af2053442ca1792` |
| `docs/implementation/M1_BOOTSTRAP_DECISIONS.md` | `d342becbde4737d72ef3fb07cb5b0aa09b2e509701eae8bb68ed6651c8610158` |

The freeze manifest is intentionally excluded from its own rows. Its SHA-256 is computed separately after every listed row is revalidated.

## 2. Pre-freeze validation result

The final deterministic validation returned **PASS**:

- expected Stage 1 implementation documents: 3/3;
- direct JavaScript dependency pins: 46/46 exact;
- required Stage 1 decisions: present and mutually consistent;
- local document references: 7/7 resolved;
- Markdown fenced blocks: balanced;
- critical drafting markers (`TBD`, `TODO`, `FIXME`, `XXX`, `BLOCKER`, `NO-GO`, unresolved-critical marker): 0;
- credential/secret pattern matches in the three Stage 1 documents: 0;
- constitution checks for two auth realms, one migration chain, dependency direction, one signed artifact and no initial Turborepo: PASS;
- root `AGENTS.md` is byte-identical to `docs/reviews/AGENTS_CANDIDATE.md` and matches the hash declared by the Accepted Phase 0 baseline.

One factual wording error was corrected before this first freeze: the tested pnpm override deliberately replaces Chevrotain's exact transitive `lodash@4.17.21` pin; it does not satisfy an alleged semver range. No frozen candidate existed before that correction.

No separate Stage 1 evidence/index file is needed to interpret this candidate. `M1_VERSION_COMPATIBILITY_MATRIX.md` records the technical result matrix, source ledger and hashes of the disposable probe artifacts; the disposable artifacts themselves were removed as required.

## 3. Package-store disposition

The shared `/tmp/.pnpm-store` is package-cache state, not TravelOS product state. Targeted scans found:

- no TravelOS-named package-cache path;
- no probe-specific content match;
- no retained probe secret value;
- one broken pnpm project-metadata symlink pointing to `/tmp/travelos-stage1-probe`.

Only that clearly probe-specific broken symlink was removed. The shared content-addressed package cache was preserved.

## 4. CT 200 mutation statement

CT 200 was **not modified** during Stage 1 or this freeze turn. No package refresh/install, file/database/user/group creation, Git initialization, service/network/firewall change, application scaffold, deployment or reboot was performed on CT 200.

## 5. Review and closure contract

These **six exact file byte sequences** are the Stage 1 candidate for independent review. A reviewer must recompute every row before semantic review and stop on any missing file, count mismatch or digest mismatch.

This freeze does not itself close Stage 1 and does not authorize Stage 2. Independent review and closure must leave no open BLOCKER or valid HIGH finding before a later Stage 1 gate may recommend GO for Stage 2.

The six listed files must not be edited after this freeze. Any required correction creates a new freeze generation; this record is never rewritten to make a later candidate appear identical.
