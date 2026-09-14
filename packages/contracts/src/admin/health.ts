import { z } from "zod";

export const AdminHealthLiveResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("admin-api"),
    environment: z.literal("DEVELOPMENT"),
  })
  .strict();

export type AdminHealthLiveResponse = z.infer<typeof AdminHealthLiveResponseSchema>;
