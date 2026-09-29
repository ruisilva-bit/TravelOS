import type { OpaqueId } from "../../../shared-kernel/opaque-id.js";

export type CustomerPersonRole = "PRIMARY_CONTACT" | "TRAVELLER" | "PAYER" | "GUARDIAN";
export type TripTravellerRole = "PRIMARY_TRAVELLER" | "TRAVELLER" | "PAYER";

export interface PersonDraft {
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string | null;
}

export interface CustomerDraft {
  readonly displayName: string;
}

export interface Person {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string | null;
  readonly lockVersion: number;
}

export interface Customer {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly displayName: string;
  readonly lockVersion: number;
}

export interface CustomerPerson {
  readonly agencyId: OpaqueId;
  readonly customerId: OpaqueId;
  readonly personId: OpaqueId;
  readonly role: CustomerPersonRole;
  readonly isPrimary: boolean;
}

export interface TripTraveller {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly personId: OpaqueId;
  readonly role: TripTravellerRole;
}

export interface PrimaryTripTraveller extends TripTraveller {
  readonly role: "PRIMARY_TRAVELLER";
}

const nonEmpty = (value: string, label: string): void => {
  if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
};

export const validatePersonDraft = (draft: PersonDraft): void => {
  nonEmpty(draft.givenName, "Person given name");
  nonEmpty(draft.familyName, "Person family name");
  if (draft.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(draft.email)) {
    throw new Error("Person email is invalid");
  }
};

export const validateCustomerDraft = (draft: CustomerDraft): void => {
  nonEmpty(draft.displayName, "Customer display name");
};
