# Product Owner decision adjustment — gen13

Rui approved the narrow DEVELOPMENT cleanup route on the existing Admin API listener.
Immutable publication snapshots and audit/outbox history remain retained.
Candidate rollover only; no product-scope expansion.

Rui's current instruction to finish Stage 7 autonomously supersedes the earlier generation-only stop. Alex selects gen13 for the minimal runner identity correction, a versioned sealed-artifact one-shot unit installer, one candidate-scoped canonical CI and the normal CT200 DEVELOPMENT deployment/acceptance/review/closure gates. No previous CI is repeated and no protected candidate bytes are rewritten. This is not production, a new listener, credential provisioning, root SSH, a sudoers change or Stage 8 authority.

The previous gen12 CI PASS remains valid for its exact bytes, but its actual packaged runner rejected gen12 before credentials. The exact preflight blocker remains preserved. The new CLI derives generation from its hash-bound packaged extension and checks release identity/commit consistency before credential delivery. Unit installation must verify the sealed artifact, the external CI receipt and the exact packaged unit; it installs only this one-shot unit and reloads systemd, without enabling or starting it. Credentials remain the five existing encrypted references.

Stage 7 actions = 1
Stage 8 actions = 0
