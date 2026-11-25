# TravelOS Identity, Roles and Permissions

**Status:** Accepted — Phase 0 foundation  
**Governing ADRs:** ADR-007, ADR-008, ADR-011

## 1. Security principals

TravelOS has two independent human security realms.

| Property | Staff realm | Portal realm |
|---|---|---|
| Principal | `StaffPrincipal` | `PortalPrincipal` |
| Purpose | Agency operations/administration | Customer-facing published access/actions |
| Auth base path | `/api/auth/staff/*` | `/api/auth/portal/*` |
| Browser host | Admin host | Portal host/custom domain |
| Cookie | Host-only `__Host-travelos-staff` | Host-only `__Host-travelos-portal` |
| Tables | Dedicated staff auth tables | Dedicated Portal auth tables |
| Secret/key material | Staff realm secret reference | Different Portal realm secret reference |
| Authorization | Staff membership + RBAC + scope/policy | Explicit Trip/Document/action grants |
| MFA | Mandatory for production staff | Optional V1; risk-based later |

The same normalized email may exist in both realms. It creates no link and grants no permission. A Person/Customer/Traveller is not a principal. An optional, audited link between PortalPrincipal and Person supports UX but conveys no authority.

There is no hidden cross-customer “platform admin” principal inside an Agency instance. Managed support uses an explicit, customer-approved, expiring local Staff Principal with visible audit history.

## 2. Authentication decision

Use two independently configured Better Auth instances embedded at the NestJS delivery boundary, behind TravelOS authentication/session ports. Business modules never import Better Auth types.

V1 policy:

- invitation-only staff enrolment;
- verified email and password for both realms;
- memory-hard library-managed password hashing; no custom password cryptography;
- mandatory TOTP MFA and hashed recovery codes for all production Staff Principals;
- opaque server-side sessions in Secure, HttpOnly, SameSite=Lax, host-only cookies;
- no browser bearer token in local/session storage;
- Portal invitation explicitly establishes a PortalPrincipal and TripAccessGrant;
- password reset/invitation tokens are single-use, hashed at rest, short-lived and invalidate relevant prior sessions;
- enumeration-safe responses and throttling by account/network risk;
- high-risk staff actions require recent MFA assurance (publish, role/user administration, exports, private documents, payments, audit export);
- staff session: 8-hour idle / 7-day absolute maximum; Portal session: 30-day absolute maximum, both revocable;
- Origin/Host validation and CSRF protection on state-changing cookie-authenticated requests;
- same-origin static SPA + `/api` proxy is the default; CORS is closed unless a reviewed integration requires it.

The selected Better Auth version must pass realm-table separation, cookie isolation, MFA, revocation and no-JavaScript credential tests before product features rely on it. A failure changes the auth adapter decision, not the domain/permission model.

## 3. Staff authorization model

V1 uses default-deny RBAC with explicit scopes and small policy checks—not a general policy language.

### Permission registry

Permission identifiers are versioned in code and documented. Agencies may configure Roles by selecting permissions, but cannot invent permission semantics. Business use cases check permission IDs, never role names.

Initial groups include:

- `agency.view`, `agency.manage_settings`, `agency.manage_branding`;
- `staff.view`, `staff.invite`, `staff.manage_roles`, `staff.suspend`;
- `customer.view`, `customer.edit`, `traveller.view_sensitive`, `traveller.edit`;
- `sales.view`, `sales.edit`, `quote.version.create`, `sale.record`;
- `trip.view`, `trip.edit`, `trip.preview`, `trip.publish`, `trip.withdraw_publication`, `trip.access.manage`;
- `reservation.view`, `reservation.edit`;
- `finance.view_prices`, `finance.view_costs`, `finance.view_margins`, `finance.manage_payments`;
- `document.view_metadata`, `document.upload`, `document.download_private`, `document.manage`, `document.grant_portal`;
- `task.manage`, `case.manage`, `communication.manage`;
- `activity.view`, `audit.view`, `audit.export`;
- `integration.manage`, `feature.manage`.

### Role templates

Owner, Admin, Manager, Sales, Quotation, Customer Service, Finance and Read Only are templates. On Agency bootstrap they become Agency-owned Roles that may be renamed/adjusted except reserved safety constraints. Role name has no semantic meaning in code.

Owner is reserved and protected. At least one active Staff Principal must retain Owner. Owner does not bypass document access/audit invisibly; broad permissions remain explicit.

### M2 slice 1 Sales Lead capabilities

`sales.view` and `sales.edit` are registered in the code-owned permission registry (version 7) at Agency scope and are assigned to the bootstrapped Owner role: new Agencies receive them at bootstrap, and migration `0017` adds them to the existing Owner role of an upgraded database. Business code never checks a role name.

| Use case | Required permissions |
|---|---|
| List and read Leads | `sales.view` |
| Create, update and disqualify a Lead | `sales.edit` |
| Qualify a Lead (creates or links a Customer) | `sales.edit` **and** `customer.edit` |

Each use case authorizes inside the application use case and again inside the repository transaction against the live session, membership and authorization epoch; a missing permission or a Lead/Customer of another Agency gives a generic forbidden or not-found response. The `trip-operations-v1` template below is unchanged by this slice (its exact Stage 9 set is a documented contract); a Sales role template is a later decision. Lead data has no Portal access.

### Stage 9 fixed invitation role

Stage 9 provides one code-owned Agency role template, `trip-operations-v1`, for invited staff who need the workspace, preview/publish and explicit Portal Trip-grant workflows. Its exact Agency-scoped permission set is `agency.view`, `customer.edit`, `traveller.edit`, `trip.view`, `trip.edit`, `trip.preview`, `trip.publish` and `trip.access.manage`. It excludes `staff.invite`, `staff.view`, `staff.manage_roles`, `staff.suspend`, `agency.manage_settings`, finance permissions, reservation permissions, `trip.withdraw_publication` and `runtime_acceptance.fixture.manage`. Invitation requests cannot select another role or submit permission IDs.

Issuing, listing, reissuing or revoking a Staff invitation requires `staff.invite` at Agency scope and recent MFA no older than five minutes. The server derives the Agency and actor from the Staff session. Each state-changing transition is audited; issuance/reissue returns the raw token once, while persistence and later list responses contain only its digest/safe metadata. Acceptance creates the fixed assignment atomically and gives no Admin authorization context until TOTP is enabled and verified. There is no public Staff signup.

### Scope

A RoleAssignment is scoped to:

- entire Agency; or
- an OrganizationUnit subtree where the permission is declared scope-capable.

Resource-level sharing, where needed, is an explicit grant/policy, not thousands of ad hoc RoleAssignments. V1 has no explicit deny grants: effective permissions are the union of active RoleAssignments in scope, followed by mandatory policy constraints. Default is deny.

## 4. Authorization algorithm

Every staff command/query performs, server-side:

1. authenticate the Staff Principal in the staff realm;
2. require active StaffMembership and non-expired session;
3. verify the target `agency_id` equals the session Agency;
4. load code permission and evaluate active RoleAssignments at Agency/OrganizationUnit scope;
5. apply mandatory resource policy (ownership, state, separation of duties, recent MFA, last-Owner rule);
6. scope repository query/update by `agency_id` and expected resource scope;
7. return generic not-found/forbidden behaviour that does not leak cross-scope existence;
8. write appropriate Audit Event, including denied high-risk attempts.

UI visibility is convenience only. Hiding a button is never authorization.

## 5. Portal authorization

Portal permissions are capabilities derived from explicit grants, not staff RBAC.

### TripAccessGrant

An active grant identifies:

- Agency, Portal Principal and Trip;
- allowed capability set such as `trip.view_current`, `message.create`, `request.create`;
- issue/revoke actor and timestamps;
- optional expiry;
- optional relationship label for UX only.

A Customer, Person, Traveller, family/group or matching email does not create a grant. Enrolment and grant issue are separate transactional operations/audit events, even if orchestrated in one invitation use case.

### DocumentGrant

Document access is evaluated independently for every listing and download. A grant identifies Portal Principal, Document or version scope, allowed action, expiry and revocation. A TripAccessGrant is necessary for trip-scoped presentation but never sufficient for a document.

A traveller may receive only their own passport/policy while another trip participant sees none. Guardians/delegates require explicit grants. Confidential and Restricted Portal documents are streamed/proxied through the Portal API after a fresh authorization check; V1 does not issue a reusable or direct-to-storage signed URL for them.

## 6. Resource policy examples

| Operation | Required controls |
|---|---|
| View supplier cost | `finance.view_costs`, correct scope; never Portal |
| View margin | `finance.view_margins`; never Portal |
| Publish Trip | `trip.publish`, expected revision/hash, recent MFA, publishable state |
| Withdraw publication | dedicated permission, recent MFA, reason, Audit Event |
| Assign staff role | `staff.manage_roles`, recent MFA, cannot remove last Owner |
| Issue, list, reissue or revoke Staff invitation | `staff.invite`, Agency scope, recent MFA ≤ 5 minutes; server-derived Agency/actor; audited state changes |
| Download private document | explicit staff permission and resource scope, or active Portal DocumentGrant |
| Grant document to Portal | `document.grant_portal`, available/clean version, grant cannot exceed issuer policy |
| Manage payments | `finance.manage_payments`, scope and immutable correction rules |
| Audit export | `audit.export`, recent MFA, justification and export audit |

## 7. Revocation and race behaviour

- Membership suspension and role/grant revocation take effect on the next request; high-risk operations re-evaluate authorization inside their transaction.
- Revocation increments a principal authorization epoch. Sessions carry/check that epoch so cached authorization cannot survive revocation.
- Protected Portal downloads recheck session, TripAccessGrant, DocumentGrant and authorization epoch before each response. Revoking any of them makes a previously discovered download endpoint fail on its next use; no residual capability TTL is accepted. Bytes already delivered cannot be revoked retroactively.
- Publish rechecks permission/MFA after acquiring its transaction lock.
- Access caches are per request or short-lived and keyed by principal authorization epoch and Agency.

## 8. Separation of duties and emergency access

V1 does not require two-person approval for ordinary publishing. It does require distinct permissions and step-up MFA. Privacy deletion/redaction, audit export and future high-value finance actions support a dual-confirmation workflow before production use.

There is no silent break-glass bypass. Emergency access must be an expiring role assignment with reason, customer-visible audit evidence and alerting.

## 9. Permission test matrix

For each permission-sensitive use case test:

- unauthenticated;
- wrong realm cookie;
- inactive principal/membership;
- correct role and Agency scope;
- missing permission;
- wrong OrganizationUnit;
- guessed ID from another Agency fixture even though production DB is dedicated;
- stale role/grant cache after revocation;
- missing/recent MFA where applicable;
- direct API call despite hidden UI control;
- Portal Trip grant without Document grant;
- Document grant after expiry/revocation;
- reuse of a previously obtained document endpoint after Trip/Document grant or session revocation;
- metadata, filename, count, error and timing leakage—not only response body.

Any cross-realm acceptance, cross-Agency access, or implicit document access is a BLOCKER.
