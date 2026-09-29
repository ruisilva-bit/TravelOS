import { z } from "zod";

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
} from "../itinerary/m1.js";
import {
  AdminReservationDraftSchema,
  AdminReservationItemLinkResponseSchema,
  AdminReservationResponseSchema,
  AdminSupplierCostDraftSchema,
  AdminSupplierCostResponseSchema,
} from "../reservations/m1.js";
import { AdminOpaqueIdSchema } from "../money.js";

const ADMIN_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const [yearText, monthText, dayText] = value.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const normalized = new Date(Date.UTC(year, month - 1, day));
    return (
      year >= 1000 &&
      year <= 9999 &&
      normalized.getUTCFullYear() === year &&
      normalized.getUTCMonth() === month - 1 &&
      normalized.getUTCDate() === day
    );
  }, "Invalid calendar date");

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
    startDate: ADMIN_DATE,
    endDate: ADMIN_DATE,
    state: AdminTripStateSchema,
  })
  .strict();

export const AdminTripResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    title: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    state: AdminTripStateSchema,
    workspaceRevision: z.string().regex(/^\d+$/u),
    lockVersion: z.number().int().min(1),
  })
  .strict();

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
    flight: AdminFlightResponseSchema,
    accommodation: AdminAccommodationResponseSchema,
    reservation: AdminReservationResponseSchema,
    reservationItemLinks: z.array(AdminReservationItemLinkResponseSchema),
    supplierCost: AdminSupplierCostResponseSchema,
  })
  .strict();

export type AdminCreateM1TripSliceRequest = z.infer<typeof AdminCreateM1TripSliceRequestSchema>;
export type AdminM1TripSliceResponse = z.infer<typeof AdminM1TripSliceResponseSchema>;
