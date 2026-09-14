# ADR-001: Modular Monolith

- **Status:** Accepted
- **Date:** 2026-08-13
- **Owners:** Rui (Product), Alex (Architecture)

## Context

TravelOS contains rich but tightly related sales, trip, publishing, finance, document and service domains. Premature network boundaries would add distributed transactions, deployment/version coordination and per-instance resource overhead before independent scaling/team ownership exists.

## Decision

Build one versioned modular-monolith codebase and database per instance. Express bounded contexts as explicit source modules with inward dependencies, restricted exports, stable contracts and architecture tests.

Use separate Admin API, Portal API and Worker composition-root processes from the same release. These are security/workload boundaries, not independently deployed/versioned services. The Portal root has a restricted package graph/database role.

## Consequences

- Transactions and refactoring remain simple inside an instance.
- Module discipline must be enforced; directory names alone are insufficient.
- One release upgrades all contexts together.
- Security-critical Portal isolation uses process/credential boundaries without introducing service-to-service calls.

## Rejected

- Microservices: no demonstrated independent scaling/team/availability need; high fleet cost.
- One unstructured Nest application: would make Portal/workspace leakage and domain coupling likely.
- Serverless functions: poor fit for managed CTs, database connections and uniform fleet operation.

## Revisit trigger

A context has stable contracts, independent ownership and measured scaling/availability/compliance needs that outweigh distributed-system cost. Module size alone is not a trigger.
