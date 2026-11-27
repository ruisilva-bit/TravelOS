import { createHash } from "node:crypto";
import type { TripSnapshotHashPort } from "@travelos/backend-core";

export const createTripSnapshotSha256Hasher = (): TripSnapshotHashPort => ({
  async sha256(canonicalJson) {
    return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  },
});
