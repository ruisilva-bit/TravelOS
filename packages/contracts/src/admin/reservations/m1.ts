import { z } from "zod";

import {
  AdminInternalOnlyClassificationSchema,
  AdminMoneySchema,
  AdminOpaqueIdSchema,
} from "../money.js";

export const AdminReservationStateSchema = z.enum([
  "PROVISIONAL",
  "HELD",
  "CONFIRMED",
  "USED",
  "CANCELLED",
  "FAILED",
]);

export const AdminReservationDraftSchema = z
  .object({
    supplierName: z.string().trim().min(1).max(300),
    supplierReference: z.string().trim().min(1).max(300),
    customerBookingReference: z.string().trim().max(200).nullable(),
    state: AdminReservationStateSchema,
  })
  .strict();

export const AdminReservationResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    tripId: AdminOpaqueIdSchema,
    supplierName: z.string(),
    supplierReference: z.string(),
    customerBookingReference: z.string().nullable(),
    state: AdminReservationStateSchema,
    lockVersion: z.number().int().min(1),
  })
  .strict();

export const AdminReservationItemLinkResponseSchema = z
  .object({
    agencyId: AdminOpaqueIdSchema,
    tripId: AdminOpaqueIdSchema,
    reservationId: AdminOpaqueIdSchema,
    itineraryItemId: AdminOpaqueIdSchema,
    linkRole: z.enum(["PRIMARY", "SECONDARY"]),
  })
  .strict();

export const AdminSupplierCostDraftSchema = z
  .object({
    amount: AdminMoneySchema,
    internalNote: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const AdminSupplierCostResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    tripId: AdminOpaqueIdSchema,
    reservationId: AdminOpaqueIdSchema,
    amount: AdminMoneySchema,
    internalNote: z.string(),
    classification: AdminInternalOnlyClassificationSchema,
    lockVersion: z.number().int().min(1),
  })
  .strict();

export const AdminSupplierCostNoteUpdateRequestSchema = z
  .object({
    agencyId: AdminOpaqueIdSchema,
    tripId: AdminOpaqueIdSchema,
    reservationId: AdminOpaqueIdSchema,
    expectedLockVersion: z.number().int().min(1),
    internalNote: z.string().trim().min(1).max(10_000),
  })
  .strict();
