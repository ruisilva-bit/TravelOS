import { z } from "zod";
import { TripSnapshotV1Schema } from "../../share/trip-snapshot-v1.js";

export const AdminCreateShareLinkV1RequestSchema = z
  .object({ expiresInDays: z.number().int().min(1).max(365).optional() })
  .strict();

/** The only response that ever carries the token or URL. */
export const AdminShareLinkCreatedV1ResponseSchema = z
  .object({
    shareLinkId: z.uuid(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    url: z.url(),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const AdminShareLinkSummaryV1Schema = z
  .object({
    shareLinkId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
    state: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]),
    createdBy: z.string().min(1).max(200),
  })
  .strict();

export const AdminShareLinkRevokedV1ResponseSchema = z
  .object({ revoked: z.literal(true) })
  .strict();

export const AdminShareLinkListV1ResponseSchema = z
  .object({ links: z.array(AdminShareLinkSummaryV1Schema).max(200) })
  .strict();

export type AdminCreateShareLinkV1Request = z.infer<typeof AdminCreateShareLinkV1RequestSchema>;
export type AdminShareLinkCreatedV1Response = z.infer<typeof AdminShareLinkCreatedV1ResponseSchema>;
export type AdminShareLinkSummaryV1 = z.infer<typeof AdminShareLinkSummaryV1Schema>;
export type AdminShareLinkListV1Response = z.infer<typeof AdminShareLinkListV1ResponseSchema>;

/** Strict customer allowlist, re-exported so the composition root need not import `./share`. */
export { TripSnapshotV1Schema };
