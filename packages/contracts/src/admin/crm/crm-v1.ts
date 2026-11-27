import { z } from "zod";

import { AdminLockVersionSchema } from "../lock-version.js";
import { AdminOpaqueIdSchema } from "../money.js";
import { AdminCustomerPersonRoleSchema } from "../customers/m1.js";

const CRM_PHONE_PATTERN = /^[+0-9 ()-]+$/u;
const CRM_ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const CrmDisplayNameSchema = z.string().trim().min(1).max(300);
const CrmPersonNameSchema = z.string().trim().min(1).max(100);
const CrmEmailSchema = z.string().trim().email().max(254).nullable();
const CrmPhoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(CRM_PHONE_PATTERN)
  .refine((value) => /[0-9]/u.test(value), "Phone must contain a digit")
  .nullable();
const CrmNotesSchema = z.string().trim().min(1).max(4_000).nullable();
const CrmNationalitySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/u)
  .transform((value) => value.toUpperCase())
  .nullable();
const CrmIsoDateSchema = z.string().regex(CRM_ISO_DATE_PATTERN);
const CrmPassportNumberSchema = z.string().trim().min(1).max(40).nullable();

const CrmRolesSchema = z
  .array(AdminCustomerPersonRoleSchema)
  .min(1)
  .max(4)
  .refine((roles) => new Set(roles).size === roles.length, "Roles must not repeat");

const customerEditableShape = {
  displayName: CrmDisplayNameSchema,
  email: CrmEmailSchema,
  phone: CrmPhoneSchema,
  notes: CrmNotesSchema,
} as const;

const personEditableShape = {
  givenName: CrmPersonNameSchema,
  familyName: CrmPersonNameSchema,
  email: CrmEmailSchema,
  phone: CrmPhoneSchema,
  nationality: CrmNationalitySchema,
  notes: CrmNotesSchema,
} as const;

export const AdminCustomerListV1QuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100).optional().nullable().default(null),
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-4][0-9]|50)$/u)
      .optional()
      .default("25")
      .transform(Number),
    cursor: AdminOpaqueIdSchema.optional().nullable().default(null),
  })
  .strict();

export const AdminSearchV1QuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100),
  })
  .strict();

export const AdminCustomerCreateV1RequestSchema = z
  .object({
    ...customerEditableShape,
    primaryPerson: z.object(personEditableShape).strict(),
  })
  .strict();

export const AdminCustomerUpdateV1RequestSchema = z
  .object({ expectedLockVersion: AdminLockVersionSchema, ...customerEditableShape })
  .strict();

export const AdminPersonCreateV1RequestSchema = z
  .object({
    ...personEditableShape,
    roles: CrmRolesSchema,
  })
  .strict();

export const AdminPersonUpdateV1RequestSchema = z
  .object({
    expectedLockVersion: AdminLockVersionSchema,
    ...personEditableShape,
    // Sensitive fields are optional: an omitted key keeps the stored value, null clears it.
    birthDate: CrmIsoDateSchema.nullable().optional(),
    passportNumber: CrmPassportNumberSchema.optional(),
    passportExpiry: CrmIsoDateSchema.nullable().optional(),
  })
  .strict();

export const AdminCustomerRolesV1RequestSchema = z
  .object({
    roles: CrmRolesSchema,
    isPrimary: z.boolean(),
  })
  .strict();

export const AdminPersonV1ResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    givenName: z.string(),
    familyName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    nationality: z.string().nullable(),
    notes: z.string().nullable(),
    // Redacted to null for callers without traveller.view_sensitive.
    birthDate: z.string().nullable(),
    passportNumber: z.string().nullable(),
    passportExpiry: z.string().nullable(),
    lockVersion: AdminLockVersionSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const AdminCustomerPersonV1ResponseSchema = AdminPersonV1ResponseSchema.extend({
  roles: z.array(AdminCustomerPersonRoleSchema),
  isPrimary: z.boolean(),
}).strict();

export const AdminCustomerSummaryV1ResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    displayName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    primaryContactName: z.string().nullable(),
    lockVersion: AdminLockVersionSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const AdminCustomerDetailV1ResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    displayName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    notes: z.string().nullable(),
    lockVersion: AdminLockVersionSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    people: z.array(AdminCustomerPersonV1ResponseSchema).max(100),
    leads: z
      .array(z.object({ id: AdminOpaqueIdSchema, name: z.string(), state: z.string() }).strict())
      .max(100),
    trips: z
      .array(
        z
          .object({
            id: AdminOpaqueIdSchema,
            title: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            state: z.string(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const AdminCustomerListV1ResponseSchema = z
  .object({
    items: z.array(AdminCustomerSummaryV1ResponseSchema).max(50),
    nextCursor: AdminOpaqueIdSchema.nullable(),
  })
  .strict();

export const AdminSearchV1ResponseSchema = z
  .object({
    customers: z.array(AdminCustomerSummaryV1ResponseSchema).max(5),
    leads: z
      .array(z.object({ id: AdminOpaqueIdSchema, name: z.string(), state: z.string() }).strict())
      .max(5),
    trips: z
      .array(
        z
          .object({
            id: AdminOpaqueIdSchema,
            title: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            state: z.string(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

export type AdminCustomerListV1Query = z.infer<typeof AdminCustomerListV1QuerySchema>;
export type AdminSearchV1Query = z.infer<typeof AdminSearchV1QuerySchema>;
export type AdminCustomerCreateV1Request = z.infer<typeof AdminCustomerCreateV1RequestSchema>;
export type AdminCustomerUpdateV1Request = z.infer<typeof AdminCustomerUpdateV1RequestSchema>;
export type AdminPersonCreateV1Request = z.infer<typeof AdminPersonCreateV1RequestSchema>;
export type AdminPersonUpdateV1Request = z.infer<typeof AdminPersonUpdateV1RequestSchema>;
export type AdminCustomerRolesV1Request = z.infer<typeof AdminCustomerRolesV1RequestSchema>;
export type AdminPersonV1Response = z.infer<typeof AdminPersonV1ResponseSchema>;
export type AdminCustomerPersonV1Response = z.infer<typeof AdminCustomerPersonV1ResponseSchema>;
export type AdminCustomerSummaryV1Response = z.infer<typeof AdminCustomerSummaryV1ResponseSchema>;
export type AdminCustomerDetailV1Response = z.infer<typeof AdminCustomerDetailV1ResponseSchema>;
export type AdminCustomerListV1Response = z.infer<typeof AdminCustomerListV1ResponseSchema>;
export type AdminSearchV1Response = z.infer<typeof AdminSearchV1ResponseSchema>;
