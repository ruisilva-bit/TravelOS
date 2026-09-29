# TravelOS Phase 1 M1 — Stage 5 FINAL-8 candidate validation

- **Stage:** Phase 1 M1 / Stage 5 FINAL-8 candidate
- **Status:** corrected implementation and qualification PASS; eligible for a fresh genuine independent non-author review. Closure and GO remain blocked until that review returns `GO`.
- **Historical predecessor:** FINAL-7 remains unchanged as a rejected candidate. Stage 4 remains formally closed and is not reopened.
- **Migration head:** `0007_stage5_m1_domain_slice.cjs`
- **Migration SHA-256:** `e52672ef7d720488b7b274cef30f3c89d68d8dd88fc616dc8baf356ac5265ddf`
- **Evidence index:** `docs/evidence/phase-1-m1/stage-5-final-8/EVIDENCE_INDEX.json`
- **Evidence artifacts:** 14; index SHA-256 `ef6cb9987c83928894ec2aa1f739ae8bfcbec297406b3d98f5f6f4ac1e9d5397`; evidence aggregate `b706fdb79b606c8b302f7e8bd17531e7aebbac6d1dba5e966b885dc662c56351`.
- **Predecessor freeze:** FINAL-7 SHA-256 `9197feedbf631f7ae79c3d4ff5dabae1962a4758ecb46a455c39d85a2f2b168f`.

## Historical finding provenance

FINAL-4, FINAL-5, FINAL-6 and FINAL-7 were rejected by independent reviews. FINAL-6 explicitly recorded that no independent review had been executed for its then-current candidate. Therefore this document does **not** claim that any FINAL-6 historical author correction was independently closed. The matrix below is a complete carry-forward record: historical IDs are preserved, the current correction state is authorial, and only the forthcoming FINAL-8 non-author review may independently close them.

| Historical finding | FINAL-8 status before review | Boundary/evidence carried into FINAL-8 |
|---|---|---|
| `S5F4-PRIMARY-001` | CORRECTED / PENDING INDEPENDENT REVIEW | `PRIMARY_TRAVELLER` is aligned across create contract, application, domain, persistence and singular projection. |
| `S5F4-TIME-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Calendar validity, precision, canonical timezone policy and local-tuple/instant coherence are enforced across Admin, backend and PostgreSQL. |
| `S5F4-INTERNAL-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Admin auth, M1 composite and `INTERNAL_ONLY` outcomes are private and `no-store`; negative auth paths are regression-tested. |
| `S5F4-EVIDENCE-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Stage 5 source/evidence coverage rejects every individual discovered-index omission. |
| `S5F4-QUAL-001` | CORRECTED / PENDING INDEPENDENT REVIEW | PostgreSQL qualification asserts exact traveller destinations and both workspace-revision/lock-version deltas. |
| `S5F5-PRIMARY-CARDINALITY-001` | CORRECTED / PENDING INDEPENDENT REVIEW | At-most-one uniqueness plus deferred commit-time exactly-one checks cover creation, replacement, empty state and reparenting. |
| `S5F5-TIME-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Canonical timezone registry and temporal persistence probes are qualified under the pinned toolchain. |
| `S5F5-PRIMARY-TYPE-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Domain and Admin singular primary types are narrowed to `PRIMARY_TRAVELLER`. |
| `S5F5-WORKSPACE-REVISION-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Person, Customer and CustomerPerson projection changes increment affected Trip revisions once per transaction. |
| `S5F5-MONEY-VALIDATION-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Structural Money is rejected or reconstructed before persistence. |
| `S5F6-EVIDENCE-PROVENANCE-001` | CORRECTED / PENDING INDEPENDENT REVIEW | FINAL-8 validation and freeze are generated from the FINAL-8 index bytes; FINAL-7 remains historical. |
| `S5F6-EVIDENCE-COVERAGE-001` | CORRECTED / PENDING INDEPENDENT REVIEW | The persisted omission matrix includes every discovered Stage 5 evidence index, including FINAL-6, FINAL-7 and FINAL-8. |
| `S5F6-TIMEZONE-CONTRACT-PARITY-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Admin, backend and PostgreSQL use the same canonical inclusion/exclusion policy. |
| `S5F6-AUTH-REGISTRY-VERSION-001` | CORRECTED / PENDING INDEPENDENT REVIEW | The real Staff-access adapter returns the code-owned permission registry version and root-Agency bootstrap is idempotently qualified. |
| `S5F6-PRIMARY-CONTINUITY-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Shared canonical Person-row locks, deferred rechecks and serial/reparent/child-first qualification protect both table paths. |
| `S5F6-MONEY-NORMALIZATION-001` | CORRECTED / PENDING INDEPENDENT REVIEW | The exported application boundary reconstructs normalized bigint Money and forwards that value. |
| `S5F6-PRIMARY-REPARENT-QUAL-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Real PostgreSQL qualification covers source-empty rejection, repaired source replacement, target reparenting and child-first insertion. |
| `S5F6-FOCUSED-TOOLCHAIN-ATTRIBUTION-001` | CORRECTED / PENDING INDEPENDENT REVIEW | The focused runner records Node, Corepack and pnpm from the invoking process boundary. |
| `S5F7-PRIMARY-CONTINUITY-CONCURRENCY-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Both CRM and traveller paths acquire the same canonically ordered write-conflicting Person locks; synchronized READ COMMITTED and REPEATABLE READ qualification covers blocking and abort/rejection. |
| `S5F7-WORKSPACE-REVISION-MONOTONICITY-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Runtime table UPDATE/INSERT column grants exclude `workspaceRevision`; revision helpers are fixed-search-path `SECURITY DEFINER`, direct function execution is revoked, and actual-login probes reject direct assignment. |
| `S5F7-WORKSPACE-REVISION-CHILD-FIRST-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Revision deduplication records the marker only after a Trip row is actually updated; child-before-parent insertion is qualified at revision `1`. |
| `S5F7-APPLICATION-INPUT-COMPLETENESS-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Exported create/update boundaries strictly reconstruct exact keys, primitives, enums, lengths, nullable fields, IDs, temporal values and Money; repository-spy tests prove rejection before persistence. |
| `S5F7-TEMPORAL-RANGE-PARITY-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Admin, backend and PostgreSQL reject dates before `1000-01-01`, accept `1000-01-01`, and retain the upper bound policy. |
| `S5F7-SOURCE-SCAN-ORDER-001` | CORRECTED / PENDING INDEPENDENT REVIEW | A post-freeze, read-only sensitive/source scan binds the final source/evidence/review bytes to a deterministic path/bytes/hash aggregate; its report is external to the scanned scope to avoid self-reference. |
| `S5F7-ADJUDICATION-PROVENANCE-001` | CORRECTED / PENDING INDEPENDENT REVIEW | FINAL-8 preserves the complete carry-forward matrix and makes no false claim of FINAL-6 independent closure. |
| `S5F7-AUTH-CACHE-001` | CORRECTED / PENDING INDEPENDENT REVIEW | Cache policy is set before every auth bridge decision, including wrong-host, wrong-prefix, unauthenticated and unauthorized outcomes; four dedicated tests pass. |

## Qualification gates

- **Focused validation:** PASS — 5 files / 25 tests, repository-owned runner, Node `v24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`.
- **Auth bridge regression:** PASS — 1 file / 4 tests covering negative and successful Staff auth bridge paths, including cache policy.
- **PostgreSQL:** PASS — disposable PostgreSQL `18.6`, 1 integration file / 16 tests; loopback-only runtime, migration/checksum-verified packages, cleanup PASS, `ct200Actions: 0`. The suite includes synchronized cross-table continuity attempts under READ COMMITTED and REPEATABLE READ, direct Admin API login-role assignment denials, child-before-parent insertion and revision assertions.
- **Source-scope regression:** PASS — 407 files at the pre-validation/freeze evidence checkpoint; 10 discovered Stage 5 evidence indexes are required and every individual index omission is rejected. The post-freeze scan report records the final byte scope after FINAL-8 validation and freeze are present.
- **Migration verification:** PASS — the migration checksum report records the current head hash above.
- **Full CI:** PASS — 24/24 gates under Node `24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`.
- **Stage 6 actions:** `0`.

The earlier Node `22.22.2` / Corepack `0.34.6` run is non-authoritative and is not used for FINAL-8.

## Review gate

No independent review is claimed in this authoring artifact. FINAL-8 is ready for a fresh genuine, read-only, non-authoring independent review against the exact FINAL-8 freeze. Closure and GO remain blocked until that reviewer returns `GO` with no open BLOCKER/HIGH findings. Stage 6 remains excluded and has zero actions.
