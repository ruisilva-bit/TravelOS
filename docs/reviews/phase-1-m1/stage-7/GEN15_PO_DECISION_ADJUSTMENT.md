# Product Owner decision adjustment — gen15

Rui approved the narrow DEVELOPMENT cleanup route on the existing Admin API listener.
Immutable publication snapshots and audit/outbox history remain retained.
Candidate rollover only; no product-scope expansion.

Rui's instruction to finish Stage 7 autonomously governs the bounded successor. Gen14's real packaged acceptance and cleanup passed, but its single canonical CI failed at gate6 because the accepted Stage 6 verifier worktree was attached to its preserved branch rather than detached. Its exact source/artifact/baseline/CI receipts remain immutable. The same clean accepted worktree is now detached at the exact accepted commit, preserving its branch, files and historical sidecars; the actual predecessor scanner passes. Gen14 CI is never repeated.

Before delivery Alex also verified two existing-contract authorization gaps: a same-Agency non-creator could begin cleanup, and empty cleanup could begin without all four documented permissions. Real PostgreSQL and unit RED tests reproduced both; gen15 restricts both repository paths to the recorded creator and rechecks all four permission IDs before any state transition, including empty/replayed runs. Positive cleanup and replay remain supported; no new role or capability is introduced. This is a correction to the already approved same-Agency/creator and permission contract, not a new product decision.

The remaining delivery is exact artifact rehearsal, one candidate-scoped canonical CI, CT200 DEVELOPMENT backup/restore/migration/deploy, authenticated acceptance with independently queried cleanup, evidence/freeze, independent review and local closure. Reuse existing encrypted credential references and the existing authorized local root executor for the versioned sealed-artifact one-shot installer. Keep the gen09 helper unchanged. No production, new listener, credential, root SSH/sudoers change, public exposure, direct auth-table edit, destructive operation or push is authorized.

Stage 7 actions = 1
Stage 8 actions = 0
