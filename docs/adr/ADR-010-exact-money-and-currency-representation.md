# ADR-010: Exact Money and Currency Representation

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

TravelOS manages prices, costs, fees, tax, commission, payments, refunds and margins. Binary floating point produces unacceptable rounding/integrity risk. Currency scales/policies can evolve.

## Decision

Represent Money as signed `bigint` minor units plus ISO currency code and pinned scale metadata. PostgreSQL stores `bigint`; TypeScript uses `bigint`; JSON uses strings. Exchange/percentage/intermediate arithmetic uses exact Decimal (`numeric`/`decimal.js`) and requires an explicit rounding strategy.

Default V1 **commercial pricing** rounding is HALF_UP at named currency boundaries. It is not universal: tax/fiscal, foreign-exchange, payment/allocation, supplier-settlement and accounting contexts must choose their explicit jurisdiction/provider/accounting strategy and fail if that required policy is unknown. Every material result retains the policy ID/version and boundary. Allocation uses its selected deterministic policy and asserts exact conservation. Original/converted amounts, rate source/effective time and rounding policy are retained. Accepted Quote/Sale financial facts are immutable.

## Consequences

- Exact addition/allocation and no float ambiguity.
- All API/UI formatting/parsing needs deliberate adapters.
- Rare currencies/provider cash increments need explicit policy metadata.

## Rejected

- JavaScript/SQL floating types.
- Unscaled generic decimal Money without currency.
- Integer minor units without pinned scale/policy history.
- Overwriting historical amounts after rate/policy changes.

## Revisit trigger

Jurisdiction/provider evidence requires cash increments, variable-scale instruments or accounting policies not covered by explicit rounding strategies. The no-float invariant remains.
