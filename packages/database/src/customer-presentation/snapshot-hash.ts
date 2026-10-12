import { createHash } from "node:crypto";
import type { PortalTripSnapshotHashPort } from "@travelos/backend-core";

export const createPortalTripSnapshotSha256Hasher = (): PortalTripSnapshotHashPort => ({
  async sha256(canonicalJson) {
    return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  },
});
