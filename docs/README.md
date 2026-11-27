# TravelOS Architecture Documentation

**Phase:** 0 — Technical foundation  
**Status:** Accepted Phase 0 foundation — GO recorded for Phase 1 M1

## Authority order

1. `IDEA.md` — product intent and fixed constraints.
2. Accepted ADRs in `docs/adr/` — decisions and consequences.
3. Canonical architecture documents in this directory.
4. Root `AGENTS.md` — one-page working rules. [ADR-016](adr/ADR-016-internal-single-agency-tool.md) (internal single-agency tool) takes precedence where it supersedes older ADRs.

When documents conflict, stop and repair the conflict. Do not let implementation silently choose a new architecture.

## Canonical documents

| Document | Owns |
|---|---|
| [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md) | Product scope, actors, lifecycle, assumptions and non-functional envelope |
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md) | Ubiquitous language, bounded contexts, aggregates and invariants |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Application architecture, modules, contracts, jobs, testing, CI and observability |
| [DEPLOYMENT_MODEL.md](DEPLOYMENT_MODEL.md) | Dedicated-instance topology, environments, upgrades, backups and future fleet contract |
| [DATA_MODEL.md](DATA_MODEL.md) | Logical relational model, money, constraints, persistence and migration policy |
| [PUBLISHING_MODEL.md](PUBLISHING_MODEL.md) | Workspace/presentation separation, preview, publication and snapshot evolution |
| [PERMISSIONS.md](PERMISSIONS.md) | Staff RBAC and authorization policy |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Admin and customer-facing experience principles, tokens and accessibility |
| [SECURITY_MODEL.md](SECURITY_MODEL.md) | Threat model, authentication, documents, privacy and security controls |

## Supporting records

- [ADR index](adr/README.md)

## Status meanings

- **Proposed** — option is being evaluated.
- **In Review** — coherent candidate, not yet independently closed.
- **Accepted** — approved technical foundation; changes require an ADR.
- **Superseded** — retained for history and linked to its replacement.

Phase 0 completed as documentation only; it created no application, database, service or infrastructure change. The recorded GO authorizes only the accepted Phase 1 milestone **M1 — Secure Published Trip Walking Skeleton**. It is not production approval, public-exposure approval or permission to use real customer data; M1 and pre-production gates remain mandatory.
