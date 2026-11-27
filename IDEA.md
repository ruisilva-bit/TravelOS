# TravelOS

## Product Idea

TravelOS is a modern operational platform for travel agencies.

The goal is to provide a complete operational cockpit where a travel agency can manage the full lifecycle of its customers and trips without spreading information across CRM tools, email, WhatsApp, spreadsheets, supplier websites, documents and task-management systems.

TravelOS should support both:

* a single-person travel agency where one person performs sales, quotation and customer-service work;
* larger agencies with specialised Sales, Quotation, Customer Service, Finance and Management teams.

The product must work completely without AI.

AI may be introduced later as an optional intelligence layer, but the core product must never depend on it.

---

## Core Lifecycle

The main business lifecycle is:

Lead
→ Customer
→ Travel Request
→ Opportunity
→ Quote
→ Sale
→ Trip
→ Reservations
→ Travel Operations
→ Customer Service
→ Post-trip

TravelOS should preserve the complete context and history throughout this lifecycle.

---

## Main Product Areas

TravelOS should eventually provide:

* Agency cockpit
* CRM
* People and traveller profiles
* Families / traveller groups
* Leads
* Travel requests
* Sales opportunities
* Configurable sales pipelines
* Quotations
* Quote versions
* Proposal alternatives
* Suppliers
* Costs
* Sale prices
* Fees
* Commissions
* Margins
* Trips
* Structured itineraries
* Reservations
* Payments
* Documents
* Tasks
* Customer-service cases
* Communications
* Activity history
* Audit history
* Global search
* Customer share links
* Integrations
* Automation
* Reporting and insights

AI is explicitly NOT part of the initial core.

---

## Customer Share Links

Customers do not log in (ADR-016). TravelOS is an internal tool for one agency; customers receive a revocable, read-only share link to a frozen snapshot of their trip.

It should provide the customer with access to relevant information before, during and after a trip.

Possible sections include:

* Overview
* Itinerary
* Documents
* Payments
* Messages
* Travellers

The shared view should be mobile-first and modern.

---

## Critical Publishing Principle

The internal agency workspace and what customers see are NOT live mirrors of each other.

Agency staff work on mutable internal data.

Internal changes must NOT immediately become visible to customers.

Customer-facing information requires explicit publication.

The workflow is:

Internal Workspace
→ Preview as Customer
→ Publish
→ Immutable Published Version
→ Customer share link

The customer sees the latest explicitly published version.

If staff change a hotel, flight, transfer, description or another customer-visible field internally, the customer must continue seeing the previous published version until a staff member explicitly publishes the changes.

Publishing should create an immutable historical version.

Previous versions must remain auditable.

---

## Structured Itinerary

A trip is composed of independent structured itinerary items.

Initial item families may include:

* Flight
* Accommodation
* Transfer
* Activity
* Insurance
* Vehicle Rental
* Rail
* Ferry
* Cruise
* Other

Each item family has its own structured fields.

A Flight is not merely text.

It may contain information such as:

* airline
* flight number
* departure airport
* arrival airport
* departure datetime
* arrival datetime
* terminal
* cabin
* baggage
* seat
* booking reference
* status

An Accommodation item has a different structured field set.

This structured-data model is important for future search, reporting, automation and provider integrations.

---

## Reservation vs Itinerary Item

A Reservation and an Itinerary Item are different concepts.

Example:

One airline reservation / PNR may contain:

Porto → Madrid
Madrid → New York

These are two itinerary flight segments but may belong to the same reservation.

The domain model must preserve this distinction.

---

## Operational Data vs Customer Presentation

Operational information and customer-facing presentation are separate concerns.

Internal information may include:

* supplier
* supplier reference
* supplier cost
* commission
* margin
* internal notes
* operational status

Customer presentation may include:

* title
* description
* image
* useful instructions
* customer-facing booking information

The customer-facing view must never simply expose complete internal database objects.

---

## Customer Field Visibility

Structured fields must support customer-visibility policies.

Visibility should conceptually resolve through:

Platform Default
→ Agency Default
→ Item Override

Some fields are permanently INTERNAL_ONLY and can never be exposed to customers.

Examples:

* supplier cost
* margin
* internal notes
* credentials
* sensitive internal commercial information

Other fields can be configured by an agency.

---

## History and Auditability

TravelOS should make history a core product characteristic.

Important actions should create human-readable activity history.

Examples:

* quote created
* price changed
* hotel changed
* responsible user changed
* payment received
* document uploaded
* trip published
* case opened
* message received

A separate immutable Audit Log should exist for security and accountability.

Activity Timeline and Audit Log are different systems.

---

## Users, Teams and Permissions

TravelOS must support agencies with different organisational structures.

Possible role templates:

* Owner
* Admin
* Manager
* Sales
* Quotation
* Customer Service
* Finance
* Read Only

Roles should eventually be configurable.

Permissions should be granular.

Examples:

* view customers
* edit customers
* view supplier costs
* view margins
* publish trips
* manage payments
* manage customer documents

A person may perform multiple roles.

---

## Deployment Model

TravelOS will initially use a managed dedicated-instance model rather than placing every customer agency inside the same shared application/database.

The default model is:

One customer agency
→ One dedicated TravelOS instance
→ One Proxmox CT
→ One independent PostgreSQL database

All customer instances must run the SAME TravelOS codebase.

Customer-specific code forks are forbidden.

Differences between customers must use:

* configuration
* branding
* feature flags
* plans / entitlements
* integrations

The application should remain Organization-aware so that a deployment can eventually support branches, brands or business units and so that a shared-cloud model remains possible in the distant future.

---

## Future Control Plane

A separate TravelOS Control Plane may eventually manage the dedicated instance fleet.

It may manage:

* customers
* instances
* provisioning
* application versions
* deployments
* health
* backups
* licensing
* subscriptions
* plans
* feature entitlements

The Control Plane is NOT part of the initial application milestone.

---

## Development Environment

Current development target:

Proxmox node:
pxmx2

Container:
CT 200

Hostname / purpose:
travelos-dev

IP:
192.168.1.200

Hermes Agent has remote access to this machine.

This is a DEVELOPMENT environment.

It must not be treated as production.

---

## Technical Direction

The initial architectural direction is:

* Modular monolith
* TypeScript
* Next.js for Agency Admin
* NestJS backend
* PostgreSQL
* Prisma
* pnpm
* Turborepo
* Tailwind CSS
* shadcn/ui
* Zod
* Playwright
* background worker
* provider abstractions for external integrations

These are proposed decisions and should be critically reviewed during architecture planning before implementation.

Microservices should NOT be introduced without a demonstrated need.

---

## Integration Philosophy

TravelOS should work without external travel-provider APIs.

Existing travel agencies must be able to continue using their current suppliers manually while TravelOS manages the operational process.

Integrations can progressively bring external systems into TravelOS.

External systems must use provider abstractions rather than contaminating the core business domain.

Future categories may include:

* CommunicationProvider
* PaymentProvider
* FlightProvider
* AccommodationProvider
* AccountingProvider
* CalendarProvider
* StorageProvider
* NotificationProvider

---

## Automation and AI

Automation should precede AI.

Future deterministic automation model:

Trigger
→ Conditions
→ Actions

Example:

Proposal published
→ wait 48 hours
→ customer has not responded
→ create follow-up task

AI may later provide capabilities such as:

* conversation summarisation
* email-to-request extraction
* reply suggestions
* proposal assistance
* document extraction
* comparison assistance
* operational anomaly detection

But these capabilities must use the same existing domain model, permissions and data.

---

## Design Direction

TravelOS must feel like a modern premium SaaS product.

Quality references include:

* Linear
* Stripe
* Attio
* Notion

These are inspiration for interaction quality and information hierarchy, not visual templates to copy.

Desired characteristics:

* modern
* fast
* calm
* contextual
* responsive
* accessible
* keyboard friendly
* strong information hierarchy
* minimal navigation
* progressive disclosure

Avoid:

* old ERP appearance
* enormous sidebars
* excessive cards
* useless dashboards
* visual clutter
* unnecessary modal dialogs

---

## Development Philosophy

Architecture before features.

The project should prioritise:

* correctness
* maintainability
* security
* auditability
* clear domain boundaries
* reproducible deployments
* safe database migrations
* automated tests
* independent code review

Do not build the whole product at once.

Build small vertical slices and validate architecture continuously.

The first major functional milestone should eventually prove:

Agency
→ User
→ Customer
→ Travel Request
→ Opportunity
→ Quote
→ Flight + Accommodation
→ Trip
→ Preview
→ Publish v1
→ Client sees v1
→ Staff changes Hotel
→ Client still sees v1
→ Publish v2
→ Client sees v2
→ v1/v2 history remains available

---

## North Star

When an agency employee opens TravelOS they should immediately understand:

* what is happening in the agency;
* what needs their attention;
* who is responsible;
* what has happened previously;
* what they need to do next;

without needing to search across unrelated systems.

TravelOS should become the operational source of truth for the agency.
