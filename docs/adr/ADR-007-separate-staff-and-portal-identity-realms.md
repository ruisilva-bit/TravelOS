# ADR-007: Separate Staff and Portal Identity Realms

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Staff operate privileged agency data; Portal users consume explicitly released content. A Person, Customer or Traveller is not necessarily a login, and email equality cannot safely transfer authority.

## Decision

Use separate StaffPrincipal and PortalPrincipal realms with distinct Better Auth instances, table namespaces, secrets, routes, cookies, sessions, invitation/recovery flows and authorization models. Business modules depend on TravelOS auth/session ports, not Better Auth types. Better Auth may generate candidate SQL for each realm, but only the reviewed TravelOS migration chain may apply it.

Staff production access requires verified invitation, password and TOTP MFA; high-risk actions require recent MFA. Portal MFA is optional V1. Opaque server-side sessions use host-only Secure HttpOnly cookies; browser token storage is forbidden.

No universal hidden support account exists. Support access is customer-approved, local, expiring and audited.

## Consequences

- Cross-realm confusion/privilege inheritance is structurally reduced.
- A human with both roles authenticates separately.
- Auth-library integration and schema upgrades must be tested twice and kept isolated.

## Rejected

- One User table/realm with role flags.
- Customer/Traveller records as credentials.
- Automatic account linking by email.
- Home-grown password/session/MFA cryptography.

## Revisit trigger

A deliberate identity federation/SSO requirement. Federation may link authentication ceremonies but must preserve realm principals and authorization separation.
