import { z } from "zod";

/** No Trip, grant, Customer, or workspace information exists in the Stage 4 Portal identity contract. */
export const PortalAuthenticatedSessionSchema = z
  .object({
    authenticated: z.literal(true),
    portalPrincipalId: z.string().min(1).max(255),
  })
  .strict();

export type PortalAuthenticatedSession = z.infer<typeof PortalAuthenticatedSessionSchema>;
