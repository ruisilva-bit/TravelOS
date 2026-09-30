import { z } from "zod";

import { AdminLockVersionSchema } from "../lock-version.js";
import { AdminOpaqueIdSchema } from "../money.js";

export const AdminPersonDraftSchema = z
  .object({
    givenName: z.string().trim().min(1).max(200),
    familyName: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320).nullable(),
  })
  .strict();

export const AdminCustomerDraftSchema = z
  .object({
    displayName: z.string().trim().min(1).max(300),
  })
  .strict();

export const AdminCustomerPersonRoleSchema = z.enum([
  "PRIMARY_CONTACT",
  "TRAVELLER",
  "PAYER",
  "GUARDIAN",
]);

export const AdminTripTravellerRoleSchema = z.enum(["PRIMARY_TRAVELLER", "TRAVELLER", "PAYER"]);
export const AdminPrimaryTripTravellerRoleSchema = z.literal("PRIMARY_TRAVELLER");

export const AdminPersonResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    givenName: z.string(),
    familyName: z.string(),
    email: z.string().email().nullable(),
    lockVersion: AdminLockVersionSchema,
  })
  .strict();

export const AdminCustomerResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    displayName: z.string(),
    lockVersion: AdminLockVersionSchema,
  })
  .strict();

export const AdminCustomerPersonResponseSchema = z
  .object({
    agencyId: AdminOpaqueIdSchema,
    customerId: AdminOpaqueIdSchema,
    personId: AdminOpaqueIdSchema,
    role: AdminCustomerPersonRoleSchema,
    isPrimary: z.boolean(),
  })
  .strict();

export const AdminTripTravellerResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    tripId: AdminOpaqueIdSchema,
    personId: AdminOpaqueIdSchema,
    role: AdminTripTravellerRoleSchema,
  })
  .strict();

export const AdminPrimaryTripTravellerResponseSchema = AdminTripTravellerResponseSchema.extend({
  role: AdminPrimaryTripTravellerRoleSchema,
});
