import { z } from "zod";

export const AdminHealthEnvironmentSchema = z.enum(["DEVELOPMENT", "INTERNAL"]);
export type AdminHealthEnvironment = z.infer<typeof AdminHealthEnvironmentSchema>;

export const AdminHealthLiveResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("admin-api"),
    environment: AdminHealthEnvironmentSchema,
  })
  .strict();

export type AdminHealthLiveResponse = z.infer<typeof AdminHealthLiveResponseSchema>;
