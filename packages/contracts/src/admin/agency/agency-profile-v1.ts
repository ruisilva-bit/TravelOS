import { z } from "zod";

import { AdminLockVersionSchema } from "../lock-version.js";

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable();

const editableShape = {
  displayName: z.string().trim().min(1).max(120),
  email: optionalText(254).pipe(z.email().nullable()),
  phone: optionalText(40),
  website: optionalText(300).pipe(z.url({ protocol: /^https$/u }).nullable()),
};

export const AdminAgencyProfileV1ResponseSchema = z
  .object({
    agencyId: z.string(),
    displayName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    lockVersion: AdminLockVersionSchema,
  })
  .strict();

export const AdminAgencyProfileV1UpdateRequestSchema = z
  .object({ expectedLockVersion: AdminLockVersionSchema, ...editableShape })
  .strict();

export type AdminAgencyProfileV1Response = z.infer<typeof AdminAgencyProfileV1ResponseSchema>;
export type AdminAgencyProfileV1UpdateRequest = z.infer<
  typeof AdminAgencyProfileV1UpdateRequestSchema
>;
