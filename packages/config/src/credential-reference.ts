import { z } from "zod";

export const CredentialReferenceIdSchema = z
  .string()
  .regex(
    /^systemd-credential:[a-z][a-z0-9-]{2,63}$/,
    "Credential references must be non-secret systemd credential identifiers",
  );

export type CredentialReferenceId = z.infer<typeof CredentialReferenceIdSchema>;
