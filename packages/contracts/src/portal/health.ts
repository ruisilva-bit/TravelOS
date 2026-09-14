import { z } from "zod";

export const PortalHealthLiveResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("portal-api"),
    environment: z.literal("DEVELOPMENT"),
  })
  .strict();

export type PortalHealthLiveResponse = z.infer<typeof PortalHealthLiveResponseSchema>;
