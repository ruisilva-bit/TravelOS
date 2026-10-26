import request from "supertest";
import { expect, it } from "vitest";
import { createAdminApi } from "../src/app.js";

it("propagates validated request correlation without reflecting hostile input", async () => {
  const app = await createAdminApi({ expectedHost: "admin.travelos.test" });
  try {
    const id = "01900000-0000-7000-8000-000000000001";
    const valid = await request(app.getHttpServer())
      .get("/health/live")
      .set("Host", "admin.travelos.test")
      .set("x-request-id", id);
    expect(valid.headers["x-request-id"]).toBe(id);
    const hostile = await request(app.getHttpServer())
      .get("/health/live")
      .set("Host", "admin.travelos.test")
      .set("x-request-id", "private@example.test");
    expect(hostile.headers["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/u);
  } finally {
    await app.close();
  }
});
