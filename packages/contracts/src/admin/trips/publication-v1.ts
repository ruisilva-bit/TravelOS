import { z } from "zod";
import { PortalTripSnapshotV1Schema } from "../../portal/customer-presentation/trip-snapshot-v1.js";

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

const ProjectionHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const WorkspaceRevisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);

export const AdminTripPublicationPreviewV1Schema = z
  .object({
    workspaceRevision: WorkspaceRevisionSchema,
    projectionHash: ProjectionHashSchema,
    schemaVersion: z.literal(1),
    projection: PortalTripSnapshotV1Schema,
  })
  .strict();

export const AdminPublishTripV1RequestSchema = z
  .object({
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    expectedProjectionHash: ProjectionHashSchema,
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !containsControlCharacter(value), "Control characters are not permitted"),
  })
  .strict();

export const AdminTripPublicationV1ResponseSchema = z
  .object({
    publicationId: z.uuid(),
    tripId: z.uuid(),
    version: z.number().int().positive().safe(),
    publishedAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal(1),
    projectionHash: ProjectionHashSchema,
    isActive: z.boolean(),
    projection: PortalTripSnapshotV1Schema,
  })
  .strict();

export const AdminTripPublicationHistoryEntryV1Schema = z
  .object({
    version: z.number().int().positive().safe(),
    publishedAt: z.iso.datetime({ offset: true }),
    actorReference: z.string().min(1).max(200),
    schemaVersion: z.literal(1),
    projectionHash: ProjectionHashSchema,
    isActive: z.boolean(),
  })
  .strict();

export const AdminTripPublicationHistoryV1ResponseSchema = z
  .object({
    entries: z.array(AdminTripPublicationHistoryEntryV1Schema).max(50),
    nextCursor: z
      .string()
      .regex(/^[1-9][0-9]*$/u)
      .nullable(),
  })
  .strict();

export type AdminTripPublicationPreviewV1 = z.infer<typeof AdminTripPublicationPreviewV1Schema>;
export type AdminPublishTripV1Request = z.infer<typeof AdminPublishTripV1RequestSchema>;
export type AdminTripPublicationV1Response = z.infer<typeof AdminTripPublicationV1ResponseSchema>;
export type AdminTripPublicationHistoryEntryV1 = z.infer<
  typeof AdminTripPublicationHistoryEntryV1Schema
>;
export type AdminTripPublicationHistoryV1Response = z.infer<
  typeof AdminTripPublicationHistoryV1ResponseSchema
>;
