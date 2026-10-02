import { z } from "zod";

import { AdminLockVersionSchema, AdminPostgresBigintSchema } from "../lock-version.js";
import {
  AdminCustomerDraftSchema,
  AdminCustomerPersonResponseSchema,
  AdminCustomerResponseSchema,
  AdminCustomerPersonRoleSchema,
  AdminPersonDraftSchema,
  AdminPersonResponseSchema,
  AdminPrimaryTripTravellerRoleSchema,
  AdminPrimaryTripTravellerResponseSchema,
} from "../customers/m1.js";
import {
  AdminAccommodationDraftSchema,
  AdminAccommodationResponseSchema,
  AdminFlightDraftSchema,
  AdminFlightResponseSchema,
  AdminLocalDateSchema,
} from "../itinerary/m1.js";
import {
  AdminReservationDraftSchema,
  AdminReservationItemLinkResponseSchema,
  AdminReservationResponseSchema,
  AdminSupplierCostDraftSchema,
  AdminSupplierCostResponseSchema,
} from "../reservations/m1.js";
import { AdminOpaqueIdSchema } from "../money.js";

export const AdminTripStateSchema = z.enum([
  "DRAFT",
  "CONFIRMED",
  "IN_OPERATION",
  "COMPLETED",
  "CANCELLED",
]);

export const AdminTripDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    startDate: AdminLocalDateSchema,
    endDate: AdminLocalDateSchema,
    state: AdminTripStateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate > value.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Trip end date must not precede its start date",
      });
    }
  });

export const AdminTripResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    title: z.string(),
    startDate: AdminLocalDateSchema,
    endDate: AdminLocalDateSchema,
    state: AdminTripStateSchema,
    workspaceRevision: AdminPostgresBigintSchema,
    lockVersion: AdminLockVersionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate > value.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Trip end date must not precede its start date",
      });
    }
  });

export const AdminCreateM1TripSliceRequestSchema = z
  .object({
    agencyId: AdminOpaqueIdSchema,
    person: AdminPersonDraftSchema,
    customer: AdminCustomerDraftSchema,
    customerPersonRole: AdminCustomerPersonRoleSchema,
    trip: AdminTripDraftSchema,
    travellerRole: AdminPrimaryTripTravellerRoleSchema,
    flight: AdminFlightDraftSchema,
    accommodation: AdminAccommodationDraftSchema,
    reservation: AdminReservationDraftSchema,
    supplierCost: AdminSupplierCostDraftSchema,
  })
  .strict();

export const AdminM1TripSliceResponseSchema = z
  .object({
    person: AdminPersonResponseSchema,
    customer: AdminCustomerResponseSchema,
    customerPerson: AdminCustomerPersonResponseSchema,
    traveller: AdminPrimaryTripTravellerResponseSchema,
    trip: AdminTripResponseSchema,
    flights: z.array(AdminFlightResponseSchema),
    accommodations: z.array(AdminAccommodationResponseSchema),
    reservations: z.array(AdminReservationResponseSchema),
    reservationItemLinks: z.array(AdminReservationItemLinkResponseSchema),
    supplierCosts: z.array(AdminSupplierCostResponseSchema),
  })
  .strict()
  .superRefine((response, context) => {
    const agencyId = response.trip.agencyId;
    const tripId = response.trip.id;
    const issueWhen = (condition: boolean, path: (string | number)[], message: string): void => {
      if (condition) context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };
    const itineraryItems = [...response.flights, ...response.accommodations];
    const itineraryItemIds = new Set(itineraryItems.map((item) => item.id));
    const reservationIds = new Set(response.reservations.map((reservation) => reservation.id));

    issueWhen(
      response.person.agencyId !== agencyId,
      ["person", "agencyId"],
      "Person Agency mismatch",
    );
    issueWhen(
      response.customer.agencyId !== agencyId,
      ["customer", "agencyId"],
      "Customer Agency mismatch",
    );
    issueWhen(
      response.customerPerson.agencyId !== agencyId,
      ["customerPerson", "agencyId"],
      "CustomerPerson Agency mismatch",
    );
    issueWhen(
      response.customerPerson.customerId !== response.customer.id,
      ["customerPerson", "customerId"],
      "CustomerPerson Customer mismatch",
    );
    issueWhen(
      response.customerPerson.personId !== response.person.id,
      ["customerPerson", "personId"],
      "CustomerPerson Person mismatch",
    );
    issueWhen(
      response.traveller.agencyId !== agencyId,
      ["traveller", "agencyId"],
      "Traveller Agency mismatch",
    );
    issueWhen(
      response.traveller.tripId !== tripId,
      ["traveller", "tripId"],
      "Traveller Trip mismatch",
    );
    issueWhen(
      response.traveller.personId !== response.person.id,
      ["traveller", "personId"],
      "Traveller Person mismatch",
    );

    const validateItineraryItems = (
      items: readonly (typeof itineraryItems)[number][],
      collection: "flights" | "accommodations",
    ): void => {
      for (const [index, item] of items.entries()) {
        issueWhen(
          item.agencyId !== agencyId,
          [collection, index, "agencyId"],
          "Itinerary item Agency mismatch",
        );
        issueWhen(
          item.tripId !== tripId,
          [collection, index, "tripId"],
          "Itinerary item Trip mismatch",
        );
      }
    };
    validateItineraryItems(response.flights, "flights");
    validateItineraryItems(response.accommodations, "accommodations");

    for (const [index, reservation] of response.reservations.entries()) {
      issueWhen(
        reservation.agencyId !== agencyId,
        ["reservations", index, "agencyId"],
        "Reservation Agency mismatch",
      );
      issueWhen(
        reservation.tripId !== tripId,
        ["reservations", index, "tripId"],
        "Reservation Trip mismatch",
      );
    }
    for (const [index, link] of response.reservationItemLinks.entries()) {
      issueWhen(
        link.agencyId !== agencyId,
        ["reservationItemLinks", index, "agencyId"],
        "Link Agency mismatch",
      );
      issueWhen(
        link.tripId !== tripId,
        ["reservationItemLinks", index, "tripId"],
        "Link Trip mismatch",
      );
      issueWhen(
        !reservationIds.has(link.reservationId),
        ["reservationItemLinks", index, "reservationId"],
        "Link Reservation is missing",
      );
      issueWhen(
        !itineraryItemIds.has(link.itineraryItemId),
        ["reservationItemLinks", index, "itineraryItemId"],
        "Link Itinerary item is missing",
      );
    }
    for (const [index, supplierCost] of response.supplierCosts.entries()) {
      issueWhen(
        supplierCost.agencyId !== agencyId,
        ["supplierCosts", index, "agencyId"],
        "Supplier cost Agency mismatch",
      );
      issueWhen(
        supplierCost.tripId !== tripId,
        ["supplierCosts", index, "tripId"],
        "Supplier cost Trip mismatch",
      );
      issueWhen(
        !reservationIds.has(supplierCost.reservationId),
        ["supplierCosts", index, "reservationId"],
        "Supplier cost Reservation is missing",
      );
    }
  });

export type AdminCreateM1TripSliceRequest = z.infer<typeof AdminCreateM1TripSliceRequestSchema>;
export type AdminM1TripSliceResponse = z.infer<typeof AdminM1TripSliceResponseSchema>;
