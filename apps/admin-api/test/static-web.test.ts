import request from "supertest";
import { describe, expect, it } from "vitest";

import { createAdminApi } from "../src/app.js";

const expectedHost = "admin.example.test";

describe("Admin API and Admin SPA boundary", () => {
  it("does not serve SPA files or fall back to the shell for non-API paths", async () => {
    const application = await createAdminApi({ expectedHost });
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
      expect(asset.text).not.toContain("window.adminStaticAssetLoaded");

      const unknownApi = await request(application.getHttpServer())
        .get("/api/unrecognized")
        .set("Host", expectedHost)
        .expect(404);
      expect(unknownApi.text).not.toContain("<main");

      await request(application.getHttpServer())
        .get("/")
        .set("Host", "unauthorized.example.test")
        .expect(404);

      await request(application.getHttpServer()).post("/").set("Host", expectedHost).expect(403);
    } finally {
      await application.close();
    }
  });
});
