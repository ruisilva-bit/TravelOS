import { z } from "zod";

import { AdminLockVersionSchema } from "../lock-version.js";
import { AdminOpaqueIdSchema } from "../money.js";

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

/** Retryable Lead commands send this key in the `Idempotency-Key` request header. */
export const ADMIN_IDEMPOTENCY_KEY_HEADER = "idempotency-key" as const;

export const AdminIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !containsControlCharacter(value), "Control characters are not permitted");

export const AdminLeadSourceSchema = z.enum([
  "WEBSITE",
  "PHONE",
  "EMAIL",
  "REFERRAL",
  "WALK_IN",
  "OTHER",
]);
export const AdminLeadStateSchema = z.enum(["OPEN", "QUALIFIED", "DISQUALIFIED"]);
export const AdminLeadDisqualificationReasonSchema = z.enum([
  "NO_RESPONSE",
  "NOT_INTERESTED",
  "NOT_SERVICEABLE",
  "DUPLICATE",
  "OTHER",
]);

const LeadContactNameSchema = z.string().trim().min(1).max(200);
const LeadContactEmailSchema = z.string().trim().email().max(320).nullable();
const LeadContactPhoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[0-9 +()-]+$/u)
  .nullable();
const LeadInternalNoteSchema = z.string().trim().min(1).max(4_000).nullable();

const leadEditableShape = {
  source: AdminLeadSourceSchema,
  contactGivenName: LeadContactNameSchema,
  contactFamilyName: LeadContactNameSchema,
  contactEmail: LeadContactEmailSchema,
  contactPhone: LeadContactPhoneSchema,
  internalNote: LeadInternalNoteSchema,
} as const;

export const AdminLeadCreateV1RequestSchema = z.object(leadEditableShape).strict();

export const AdminLeadUpdateV1RequestSchema = z
  .object({ expectedLockVersion: AdminLockVersionSchema, ...leadEditableShape })
  .strict();

export const AdminLeadQualifyV1RequestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      expectedLockVersion: AdminLockVersionSchema,
      mode: z.literal("CREATE_CUSTOMER"),
      customerDisplayName: z.string().trim().min(1).max(300).optional(),
    })
    .strict(),
  z
    .object({
      expectedLockVersion: AdminLockVersionSchema,
      mode: z.literal("LINK_CUSTOMER"),
      customerId: AdminOpaqueIdSchema,
    })
    .strict(),
]);

export const AdminLeadDisqualifyV1RequestSchema = z
  .object({
    expectedLockVersion: AdminLockVersionSchema,
    reason: AdminLeadDisqualificationReasonSchema,
  })
  .strict();

export const AdminLeadListV1QuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/u)
      .optional()
      .default("25")
      .transform(Number),
    cursor: AdminOpaqueIdSchema.optional().nullable().default(null),
    state: AdminLeadStateSchema.optional().nullable().default(null),
  })
  .strict();

export const AdminLeadV1ResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    source: AdminLeadSourceSchema,
    contactGivenName: z.string(),
    contactFamilyName: z.string(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    internalNote: z.string().nullable(),
    state: AdminLeadStateSchema,
    qualifiedCustomerId: AdminOpaqueIdSchema.nullable(),
    disqualificationReason: AdminLeadDisqualificationReasonSchema.nullable(),
    lockVersion: AdminLockVersionSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    closedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const AdminLeadListV1ResponseSchema = z
  .object({
    items: z.array(AdminLeadV1ResponseSchema).max(100),
    nextCursor: AdminOpaqueIdSchema.nullable(),
  })
  .strict();

export type AdminLeadCreateV1Request = z.infer<typeof AdminLeadCreateV1RequestSchema>;
export type AdminLeadUpdateV1Request = z.infer<typeof AdminLeadUpdateV1RequestSchema>;
export type AdminLeadQualifyV1Request = z.infer<typeof AdminLeadQualifyV1RequestSchema>;
export type AdminLeadDisqualifyV1Request = z.infer<typeof AdminLeadDisqualifyV1RequestSchema>;
export type AdminLeadListV1Query = z.infer<typeof AdminLeadListV1QuerySchema>;
export type AdminLeadV1Response = z.infer<typeof AdminLeadV1ResponseSchema>;
export type AdminLeadListV1Response = z.infer<typeof AdminLeadListV1ResponseSchema>;
