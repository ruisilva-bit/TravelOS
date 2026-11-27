import { createHash, randomBytes } from "node:crypto";
import type { ShareTokenCryptoPort } from "@travelos/backend-core";

/** Platform entropy and SHA-256 for share tokens; the domain only sees this port. */
export const createShareTokenCrypto = (): ShareTokenCryptoPort => ({
  randomBytes: (length) => new Uint8Array(randomBytes(length)),
  sha256: (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
});
