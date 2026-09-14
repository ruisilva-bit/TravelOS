# ADR-008: RBAC with Explicit Resource Scopes

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Agencies need configurable roles and multiple responsibilities without either hard-coded role-name checks or a premature policy language. Portal access is resource-specific and fundamentally unlike staff roles.

## Decision

Staff authorization is default-deny RBAC: a code-owned permission registry, Agency-owned configurable Roles/templates, multiple RoleAssignments and Agency/OrganizationUnit scope, followed by mandatory resource/state/recent-MFA policies. Business logic checks permission IDs, never role names. Repositories always scope by Agency.

Portal authorization uses explicit, revocable TripAccessGrants and independent DocumentGrants. Customer/Traveller/group/trip membership and email equality grant nothing automatically.

Authorization is re-evaluated server-side on every request/transaction. Revocation increments an authorization epoch. UI hiding is not enforcement.

## Consequences

- Understandable V1 role configuration with secure defaults.
- Some cross-cutting policies remain explicit code rather than generic rules.
- Resource grants and role scopes require exhaustive matrix testing.

## Rejected

- Hard-coded roles: not configurable and encourages semantic name checks.
- Full ABAC/policy engine: premature complexity and difficult administration.
- Portal as limited staff role: dangerous realm/data coupling.
- Implicit family/trip document sharing.

## Revisit trigger

Repeated requirements cannot be expressed by RBAC + explicit grants + small code policies, demonstrated by concrete use cases and administration UX.
