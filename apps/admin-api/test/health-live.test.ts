import request from "supertest";
import { describe, expect, it } from "vitest";

import { createAdminApi } from "../src/app.js";

describe("Admin API liveness", () => {
  it("boots and exposes only the DEVELOPMENT-safe liveness response", async () => {
    const application = await createAdminApi({ expectedHost: "admin.travelos.test" });
    try {
      const response = await request(application.getHttpServer())
        .get("/health/live")
        .set("Host", "admin.travelos.test")
        .expect(200);
      expect(response.body).toEqual({
        status: "ok",
        service: "admin-api",
        environment: "DEVELOPMENT",
      });
    } finally {
      await application.close();
    }
  });
});
