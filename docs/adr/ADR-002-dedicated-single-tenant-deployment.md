# ADR-002: Dedicated Single-Tenant Deployment

> Superseded in part by ADR-016.

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

The product constraint is managed isolation: one customer Agency normally receives one TravelOS instance in one Proxmox CT. The product must nevertheless model branches/brands and remain automatable at fleet scale.

## Decision

One deployment contains exactly one root Agency in V1. Organization Units model branches/brands beneath it; Teams model collaboration. All Agency-owned records retain `agency_id`, and authorization/repositories scope by it even though the database is dedicated.

Instances use the same immutable code artifact. Customer differences use external configuration, branding publications, entitlements and provider selection. The instance manifest declares exact Admin/Portal FQDNs; a request host selects a surface within the one instance, never an Agency record. Unknown hosts fail closed at edge and API. Customer source forks/local patches are forbidden.

## Consequences

- Strong operational/data isolation and simple per-customer restore/export.
- More instances to patch, monitor and back up; uniform automation is mandatory.
- Root Agency scope preserves a future shared-cloud path without pretending V1 supports multiple unrelated Agencies in one deployment.

## Rejected

- Shared multi-tenant database initially: conflicts with product constraint and increases leakage blast radius.
- One schema per customer: migration/fleet complexity and weaker isolation than independent databases.
- Customer forks: destroy upgradeability and security consistency.

## Revisit trigger

An explicit shared-cloud product initiative with threat, billing, isolation and migration ADRs. It cannot be enabled by merely inserting a second Agency row.
