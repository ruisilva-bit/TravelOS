import { z } from "zod";
import { TripSnapshotV1Schema } from "../../share/trip-snapshot-v1.js";

const ProjectionHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const WorkspaceRevisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);

/** Read-only staff preview of exactly what a customer share link would show. */
export const AdminTripPublicationPreviewV1Schema = z
  .object({
    workspaceRevision: WorkspaceRevisionSchema,
    projectionHash: ProjectionHashSchema,
    schemaVersion: z.literal(1),
    projection: TripSnapshotV1Schema,
  })
  .strict();

export type AdminTripPublicationPreviewV1 = z.infer<typeof AdminTripPublicationPreviewV1Schema>;
