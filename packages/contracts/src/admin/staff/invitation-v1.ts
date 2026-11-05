import { z } from "zod";

import { AdminOpaqueIdSchema } from "../money.js";

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

const InvitationEmailSchema = z
  .string()
  .trim()
  .max(320)
  .email()
  .refine((value) => !hasControlCharacter(value));
const InvitationTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/u, "Expected a 32-byte base64url invitation token");
const InvitationInstantSchema = z.iso.datetime({ offset: true }).refine((value) => {
  const fractionalSeconds = /\.(\d+)/u.exec(value)?.[1];
  return fractionalSeconds === undefined || fractionalSeconds.length <= 3;
});
const InvitationStatusSchema = z.enum(["PENDING", "CONSUMED", "REVOKED", "EXPIRED"]);
const InvitationNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !hasControlCharacter(value));

export const AdminStaffInvitationIssueV1RequestSchema = z
  .object({ targetEmail: InvitationEmailSchema })
  .strict();

export const AdminStaffInvitationListV1QuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-4][0-9]|50)$/u)
      .optional()
      .default("25")
      .transform(Number),
    cursor: AdminOpaqueIdSchema.optional().nullable().default(null),
  })
  .strict();

export const AdminStaffInvitationAcceptV1RequestSchema = z
  .object({
    token: InvitationTokenSchema,
    name: InvitationNameSchema,
    password: z.string().min(1).max(1024),
  })
  .strict();

export const AdminStaffInvitationMetadataV1Schema = z
  .object({
    invitationId: AdminOpaqueIdSchema,
    targetEmail: InvitationEmailSchema,
    status: InvitationStatusSchema,
    createdAt: InvitationInstantSchema,
    expiresAt: InvitationInstantSchema,
    consumedAt: InvitationInstantSchema.nullable(),
    revokedAt: InvitationInstantSchema.nullable(),
  })
  .strict()
  .superRefine((invitation, context) => {
    const hasConsumedAt = invitation.consumedAt !== null;
    const hasRevokedAt = invitation.revokedAt !== null;
    const timestampsMatchStatus =
      (invitation.status === "CONSUMED" && hasConsumedAt && !hasRevokedAt) ||
      (invitation.status === "REVOKED" && hasRevokedAt && !hasConsumedAt) ||
      ((invitation.status === "PENDING" || invitation.status === "EXPIRED") &&
        !hasConsumedAt &&
        !hasRevokedAt);

    if (!timestampsMatchStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Invitation lifecycle timestamps must match its status",
      });
    }
  });

export const AdminStaffInvitationListV1ResponseSchema = z
  .object({
    items: z.array(AdminStaffInvitationMetadataV1Schema).max(50),
    nextCursor: AdminOpaqueIdSchema.nullable(),
  })
  .strict();

export const AdminStaffInvitationOneTimeV1ResponseSchema = z
  .object({
    invitation: AdminStaffInvitationMetadataV1Schema,
    token: InvitationTokenSchema,
  })
  .strict();

export type AdminStaffInvitationIssueV1Request = z.infer<
  typeof AdminStaffInvitationIssueV1RequestSchema
>;
export type AdminStaffInvitationListV1Query = z.infer<typeof AdminStaffInvitationListV1QuerySchema>;
export type AdminStaffInvitationAcceptV1Request = z.infer<
  typeof AdminStaffInvitationAcceptV1RequestSchema
>;
export type AdminStaffInvitationMetadataV1 = z.infer<typeof AdminStaffInvitationMetadataV1Schema>;
export type AdminStaffInvitationListV1Response = z.infer<
  typeof AdminStaffInvitationListV1ResponseSchema
>;
export type AdminStaffInvitationOneTimeV1Response = z.infer<
  typeof AdminStaffInvitationOneTimeV1ResponseSchema
>;
