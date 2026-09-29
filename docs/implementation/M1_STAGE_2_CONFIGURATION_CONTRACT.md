# Phase 1 M1 Stage 2 — DEVELOPMENT configuration contract

Status: **CORRECTED — PENDING INDEPENDENT CLOSURE**

This document records the Stage 2 configuration boundary only. It does not activate a customer instance, CT 200, PostgreSQL, authentication, or later-stage business behaviour.

## API listener invariant

The DEVELOPMENT manifest configures the two API listeners independently:

- `runtime.listeners.adminApi.host` and `.port`
- `runtime.listeners.portalApi.host` and `.port`

Both hosts must be explicit IPv4 loopback addresses in `127.0.0.0/8`. Configured ports are integers from `1024` through `65535`.

The collision invariant is the exact `(host, port)` pair:

- the same host and the same port is rejected;
- the same host with different ports is accepted;
- equal port numbers on clearly distinct loopback addresses are accepted.

Host aliases are not accepted, so the validator never needs to infer whether names such as `localhost` resolve to the same address. Build smoke probes remain repository-local and request ephemeral port `0` only as a runtime test override; they do not change the configured ports or access CT 200.

## JSON Schema and runtime validation

The generated Draft 2020-12 document is a **structural schema with declared runtime refinements**, not a claim of full semantic equivalence.

### JSON-Schema-representable invariants

The generated document owns every directly representable constraint, including:

- strict root and nested object properties;
- literals, types, bounded integers, and string patterns;
- exact `hostAllowlist` length and one `ADMIN` plus one `PORTAL` entry;
- listener host grammar and port range;
- exact Admin, Portal, and Worker database role identities and credential-reference object shapes;
- compatibility, bootstrap, feature, and safe-limit shapes.

### Runtime-only invariants

The authoritative Zod parser additionally enforces cross-field comparisons that standard Draft 2020-12 cannot express without non-standard data-reference extensions:

- Admin/Portal API listener endpoint inequality;
- Admin/Portal canonical host inequality;
- allowlist host equality with each declared surface host;
- allowlist host uniqueness projected across otherwise different objects.
- pairwise inequality of the Admin, Portal, and Worker database credential references.

The machine-readable source of this split is `instanceManifestInvariantRegistry`, exported by `@travelos/config` and embedded in generated JSON Schema as `x-travelos-invariant-registry`. Consumers must run `parseDevelopmentInstanceManifest`; JSON Schema validation alone is intentionally insufficient for runtime-only invariants.
