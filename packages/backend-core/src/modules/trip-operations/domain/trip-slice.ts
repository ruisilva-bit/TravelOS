import type { Money } from "../../../shared-kernel/money/money.js";
import type { OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { ScheduledLocalDateTime } from "../../../shared-kernel/time.js";
import type {
  Customer,
  CustomerPerson,
  Person,
  PrimaryTripTraveller,
} from "../../crm/domain/continuity.js";
import type { SupplierCostLine } from "../../finance-operations/domain/supplier-cost.js";

export type TripState = "DRAFT" | "CONFIRMED" | "IN_OPERATION" | "COMPLETED" | "CANCELLED";
export type ItineraryItemFamily = "FLIGHT" | "ACCOMMODATION";
export type ItineraryItemState = "DRAFT" | "CONFIRMED" | "CANCELLED";
export type ReservationState =
  "PROVISIONAL" | "HELD" | "CONFIRMED" | "USED" | "CANCELLED" | "FAILED";

export interface Trip {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly state: TripState;
  readonly workspaceRevision: bigint;
  readonly lockVersion: bigint;
}

export interface FlightDraft {
  readonly title: string;
  readonly description: string;
  readonly carrier: string;
  readonly flightNumber: string;
  readonly departureAirport: string;
  readonly arrivalAirport: string;
  readonly departure: ScheduledLocalDateTime;
  readonly arrival: ScheduledLocalDateTime;
  readonly terminal: string | null;
  readonly cabin: string | null;
  readonly baggage: string | null;
  readonly seat: string | null;
  readonly customerBookingReference: string | null;
}

export interface AccommodationDraft {
  readonly title: string;
  readonly description: string;
  readonly propertyName: string;
  readonly checkIn: ScheduledLocalDateTime;
  readonly checkOut: ScheduledLocalDateTime;
  readonly roomDescription: string | null;
  readonly boardType: string | null;
  readonly customerBookingReference: string | null;
}

export interface FlightItem {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly family: "FLIGHT";
  readonly state: ItineraryItemState;
  readonly sortOrder: number;
  readonly title: string;
  readonly description: string;
  readonly customerBookingReference: string | null;
  readonly lockVersion: bigint;
  readonly carrier: string;
  readonly flightNumber: string;
  readonly departureAirport: string;
  readonly arrivalAirport: string;
  readonly departure: ScheduledLocalDateTime;
  readonly arrival: ScheduledLocalDateTime;
  readonly terminal: string | null;
  readonly cabin: string | null;
  readonly baggage: string | null;
  readonly seat: string | null;
}

export interface AccommodationItem {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly family: "ACCOMMODATION";
  readonly state: ItineraryItemState;
  readonly sortOrder: number;
  readonly title: string;
  readonly description: string;
  readonly customerBookingReference: string | null;
  readonly lockVersion: bigint;
  readonly propertyName: string;
  readonly checkIn: ScheduledLocalDateTime;
  readonly checkOut: ScheduledLocalDateTime;
  readonly roomDescription: string | null;
  readonly boardType: string | null;
}

export interface Reservation {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly supplierName: string;
  readonly supplierReference: string;
  readonly customerBookingReference: string | null;
  readonly state: ReservationState;
  readonly lockVersion: bigint;
}

export interface ReservationItemLink {
  readonly agencyId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly reservationId: OpaqueId;
  readonly itineraryItemId: OpaqueId;
  readonly linkRole: "PRIMARY" | "SECONDARY";
}

export interface TripSlice {
  readonly person: Person;
  readonly customer: Customer;
  readonly customerPerson: CustomerPerson;
  readonly traveller: PrimaryTripTraveller;
  readonly trip: Trip;
  readonly flights: readonly FlightItem[];
  readonly accommodations: readonly AccommodationItem[];
  readonly reservations: readonly Reservation[];
  readonly reservationItemLinks: readonly ReservationItemLink[];
  readonly supplierCosts: readonly SupplierCostLine[];
}

export interface ReservationDraft {
  readonly supplierName: string;
  readonly supplierReference: string;
  readonly customerBookingReference: string | null;
  readonly state: ReservationState;
}

export const validateTripDates = (startDate: string, endDate: string): void => {
  if (startDate > endDate) throw new Error("Trip start date must not be after its end date");
};

export const validateItineraryOrder = (sortOrder: number): void => {
  if (!Number.isInteger(sortOrder) || sortOrder < 1)
    throw new Error("Itinerary order must be positive");
};

export const validateDifferentAirports = (
  departureAirport: string,
  arrivalAirport: string,
): void => {
  if (departureAirport.trim().toUpperCase() === arrivalAirport.trim().toUpperCase()) {
    throw new Error("Flight departure and arrival airports must differ");
  }
};

export const validateReservationDraft = (draft: ReservationDraft): void => {
  if (draft.supplierName.trim().length === 0) throw new Error("Reservation supplier is required");
  if (draft.supplierReference.trim().length === 0)
    throw new Error("Reservation supplier reference is required");
};

export type SupplierCostMoney = Money;
