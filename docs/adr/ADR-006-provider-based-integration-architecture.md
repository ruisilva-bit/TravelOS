# ADR-006: Provider-Based Integration Architecture

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

TravelOS must work manually and progressively integrate storage, communications, payments, travel suppliers, accounting and other systems without vendor models contaminating the Core Domain.

## Decision

Define capability-based ports in application/domain language and implement vendor adapters with anti-corruption mapping. Domain IDs and provider references remain separate. Configuration selects adapters and secret references per instance; manual/no-provider and deterministic fake adapters are first-class.

Inbound webhooks pass signature/timestamp/replay checks into an idempotent inbox before normal commands. Outbound calls run after commit through jobs with deadlines, bounded retries and circuit policy. Before first dispatch, every effectful operation persists one stable TravelOS operation ID/business key and request hash. An adapter must provide provider-enforced idempotency under that key or a read-after-write reconciliation lookup that resolves an ambiguous timeout/crash before retry. A capability that supports neither remains manual/disabled. Every provider category has conformance tests and canonical safe error classes.

## Consequences

- Vendors can change without customer forks or domain rewrites.
- Mapping and conformance-test overhead is intentional.
- Some nominally automatable provider effects remain manual when outcome identity cannot be proven; avoiding duplicates is more important than automatic retry.
- Lowest-common-denominator ports are avoided; capability extensions need versioned interfaces.

## Rejected

- Vendor SDK imports in core modules.
- Provider-shaped database entities.
- Direct webhook mutation of domain tables.
- Requiring an integration for basic product operation.
- Blind retry after `UNKNOWN_OUTCOME` or relying only on a local “completed” flag.

## Revisit trigger

A provider exposes a genuinely new domain capability; evolve the capability model/ADR rather than add vendor flags to existing ports.
