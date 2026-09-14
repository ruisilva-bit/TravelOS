# ADR-005: Structured Itinerary Model

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Search, automation, reporting, publishing and provider integration require typed travel components. Reservations represent supplier bookings and are not the same as journey presentation segments/items.

## Decision

Model every Itinerary Item as an independent aggregate with a common typed envelope and exactly one family detail record: Flight, Accommodation, Transfer, Activity, Insurance, Vehicle Rental, Rail, Ferry, Cruise or Other.

One Flight item represents one segment. Grouping is explicit. Store travel-local civil time, IANA time zone and derived UTC instant where determinable.

Model Reservation as a separate aggregate. Connect Reservation and Itinerary Item through a same-Agency/same-Trip many-to-many association. One PNR/package may cover several items; an item may exceptionally have multiple reservations.

`Other` has required common fields and a versioned validated extension object; it cannot store finance, credentials or arbitrary internal blobs.

## Consequences

- Strong query/integration/publishing semantics and correct PNR modelling.
- More tables/mappers than a JSON blob or nullable super-table.
- Family additions require schema/domain/publication changes and tests.
- UI must display Reservation links without collapsing them into item identity.

## Rejected

- Free text/JSON itinerary: weak invariants and reporting.
- Giant nullable table: poor constraints and evolution.
- Reservation equals Item: fails multi-segment/package cases.
- One reservation-to-many items only: cannot represent legitimate multi-reservation fulfilment.

## Revisit trigger

Real provider/domain evidence that the association needs richer allocation/fulfilment semantics; extend the link entity without merging concepts.
