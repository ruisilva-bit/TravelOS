import request from "supertest";
import { describe, expect, it } from "vitest";

import { createPortalApi } from "../src/app.js";

const expectedHost = "portal.example.test";

describe("Portal API and Portal SPA boundary", () => {
  it("does not serve SPA files or fall back to the shell for non-API paths", async () => {
    const application = await createPortalApi({ expectedHost });
    try {
      const root = await request(application.getHttpServer())
        .get("/")
        .set("Host", expectedHost)
        .expect(404);
      expect(root.text).not.toContain("<main");

      const asset = await request(application.getHttpServer())
        .get("/assets/app.js")
        .set("Host", expectedHost)
        .expect(404);
      expect(asset.text).not.toContain("window.portalStaticAssetLoaded");

      const unknownApi = await request(application.getHttpServer())
        .get("/api/unrecognized")
        .set("Host", expectedHost)
        .expect(404);
      expect(unknownApi.text).not.toContain("<main");

      await request(application.getHttpServer())
        .get("/")
        .set("Host", "unauthorized.example.test")
        .expect(404);

      await request(application.getHttpServer()).post("/").set("Host", expectedHost).expect(404);
    } finally {
      await application.close();
    }
  });
});
