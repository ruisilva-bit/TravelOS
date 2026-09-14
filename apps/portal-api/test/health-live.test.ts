import request from "supertest";
import { describe, expect, it } from "vitest";

import { createPortalApi } from "../src/app.js";

describe("Portal API liveness", () => {
  it("boots and exposes only the DEVELOPMENT-safe liveness response", async () => {
    const application = await createPortalApi();
    try {
      const response = await request(application.getHttpServer()).get("/health/live").expect(200);
      expect(response.body).toEqual({
        status: "ok",
        service: "portal-api",
        environment: "DEVELOPMENT",
      });
    } finally {
      await application.close();
    }
  });
});
