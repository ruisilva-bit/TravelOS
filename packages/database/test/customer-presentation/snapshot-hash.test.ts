import { describe, expect, it } from "vitest";
import { createPortalTripSnapshotSha256Hasher } from "../../src/customer-presentation/snapshot-hash.js";

describe("Portal snapshot SHA-256", () => {
  it("matches the V1 canonical golden digest", async () => {
    const canonical =
      '{"items":[],"schemaVersion":1,"trip":{"endDate":"2026-01-02","startDate":"2026-01-01","title":"T"}}';
    const hasher = createPortalTripSnapshotSha256Hasher();
    await expect(hasher.sha256(canonical)).resolves.toBe(
      "81bdaea093d237d185c61a1facd5c3d3fd1b09b1b933193ba3cf38bb9fbe3317",
    );
  });
});
