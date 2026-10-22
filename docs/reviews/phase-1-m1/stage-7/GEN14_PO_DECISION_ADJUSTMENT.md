# Product Owner decision adjustment — gen14

Rui approved the narrow DEVELOPMENT cleanup route on the existing Admin API listener.
Immutable publication snapshots and audit/outbox history remain retained.
Candidate rollover only; no product-scope expansion.

Rui's current instruction to finish Stage 7 autonomously continues to govern this minimal correction. Alex selects gen14 after the actual gen13 packaged rehearsal failed cleanup before canonical CI. Gen13's artifact, baseline and exact failure output remain preserved; no gen13 CI was invoked and CT200 was not changed.

The failure is PostgreSQL SQLSTATE `42601`: cleanup used the unquoted reserved alias `grant` only when registered Trips exist. The correction uses `access_grant`, with a real Admin HTTP/PostgreSQL regression proving cleanup of two registered Trips and an enrolled Portal principal plus idempotent replay. No migration bytes, schema, retention semantics, credential sources or Portal permissions change. A line/path/rule-specific scanner exception covers only the test's in-memory randomBytes expression; generic detection remains unchanged and its unallowlisted negative control still fails.

Gen14 carries the previously qualified generation-derived runner and versioned sealed-artifact unit installer. After exact artifact rehearsal and one candidate-scoped canonical CI, use the existing authorized local root executor to invoke the packaged installer, then manually start the verified one-shot. The installer binds sealed release metadata, the external PASS receipt and the packaged unit. The gen09 helper remains unchanged. Existing encrypted credential references are reused; no root SSH, sudoers change, new credential, listener, public exposure, production operation or push is authorized.

The remaining gates are the normal CT200 DEVELOPMENT backup/restore, migration/deploy, authenticated acceptance with verified lifecycle cleanup, final evidence/freeze, independent review and local closure. No previous canonical CI is repeated. A failed gate stays failed rather than being relabelled complete.

Stage 7 actions = 1
Stage 8 actions = 0
