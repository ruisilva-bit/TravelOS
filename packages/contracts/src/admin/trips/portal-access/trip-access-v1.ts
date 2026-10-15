import { z } from "zod";

import { AdminOpaqueIdSchema } from "../../money.js";

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !hasControlCharacter(value));
const PrincipalIdSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim() && !hasControlCharacter(value));
const RelationshipLabelRequestSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !hasControlCharacter(value));
const RelationshipLabelResponseSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim() && !hasControlCharacter(value));
const Stage7InstantSchema = z.iso.datetime({ offset: true }).refine((value) => {
  const fractionalSeconds = /\.(\d+)/u.exec(value)?.[1];
  return fractionalSeconds === undefined || fractionalSeconds.length <= 3;
});

export const AdminTripAccessGrantIssueV1RequestSchema = z
  .object({
    agencyId: AdminOpaqueIdSchema,
    portalPrincipalId: PrincipalIdSchema,
    tripId: AdminOpaqueIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    expiresAt: Stage7InstantSchema.optional(),
    relationshipLabel: RelationshipLabelRequestSchema.optional(),
  })
  .strict();

export const AdminTripAccessGrantRevokeV1RequestSchema = z
  .object({
    agencyId: AdminOpaqueIdSchema,
    grantId: AdminOpaqueIdSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();

export const AdminTripAccessGrantV1ResponseSchema = z
  .object({
    grantId: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    portalPrincipalId: PrincipalIdSchema,
    tripId: AdminOpaqueIdSchema,
    capabilities: z.tuple([z.literal("trip.view_current")]),
    issuedByStaffPrincipalId: PrincipalIdSchema,
    issuedAt: Stage7InstantSchema,
    expiresAt: Stage7InstantSchema.nullable(),
    relationshipLabel: RelationshipLabelResponseSchema.nullable(),
    revokedByStaffPrincipalId: PrincipalIdSchema.nullable(),
    revokedAt: Stage7InstantSchema.nullable(),
  })
  .strict()
  .superRefine((grant, context) => {
    if ((grant.revokedAt === null) !== (grant.revokedByStaffPrincipalId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["revokedAt"],
        message: "Revocation actor and timestamp must be present together",
      });
    }
  });

export type AdminTripAccessGrantIssueV1Request = z.infer<
  typeof AdminTripAccessGrantIssueV1RequestSchema
>;
export type AdminTripAccessGrantRevokeV1Request = z.infer<
  typeof AdminTripAccessGrantRevokeV1RequestSchema
>;
export type AdminTripAccessGrantV1Response = z.infer<typeof AdminTripAccessGrantV1ResponseSchema>;
