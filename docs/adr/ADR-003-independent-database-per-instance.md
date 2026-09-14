# ADR-003: Independent PostgreSQL Database Per Instance

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

TravelOS needs strong relational integrity, exact financial values, transactionally safe publishing/outbox and isolated backup/restore.

## Decision

Every dedicated instance has one independent PostgreSQL database as its authoritative data system. PostgreSQL is private/local to the CT by default. Runtime roles are separated for Admin, Portal, Worker, migrations, backup and monitoring. The Portal role cannot read workspace schemas.

A single ordered schema/migration chain applies to all databases and owns TravelOS tables, both auth realms and the TravelOS job runtime. No dependency mutates schema at application startup. No customer-specific tables, columns, schema branches or migration conditions.

## Consequences

- Customer-level backup/restore and blast-radius isolation are direct.
- Fleet migration/version inventory becomes an operational requirement.
- Cross-customer analytics require a future privacy-aware projection/control-plane capability, not cross-database application queries.

## Rejected

- Shared database with row tenancy: not the selected managed model.
- Database/schema per module: adds distributed transaction/operations cost without need.
- Non-relational primary store: poor fit for constraints, joins, money and history.

## Revisit trigger

Explicit shared-cloud design or a measured module workload requiring a different derived store. PostgreSQL remains the system of record unless superseded by a migration ADR.
