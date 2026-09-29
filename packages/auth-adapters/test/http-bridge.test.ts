import { describe, expect, it } from "vitest";

import { PORTAL_AUTH_BASE_PATH, STAFF_AUTH_BASE_PATH, type AuthRealm } from "../src/realm.js";
import { dispatchAuthRealmRequest, type AuthHttpRequest } from "../src/http-bridge.js";

const policy = {
  canonicalOrigin: "http://admin.travelos.test",
  expectedHost: "admin.travelos.test",
};

const realm = (handled: Request[]): AuthRealm => ({
  kind: "STAFF",
  basePath: STAFF_AUTH_BASE_PATH,
  cookieName: "travelos-dev-staff-session",
  secureTransportRequired: false,
  async handle(request) {
    handled.push(request);
    return new Response("accepted", {
      status: 201,
      headers: { "content-type": "text/plain", "set-cookie": "travelos-dev-staff-session=value" },
    });
  },
  async getServerSession() {
    return null;
  },
});

const request = (overrides: Partial<AuthHttpRequest> = {}): AuthHttpRequest => ({
  method: "GET",
  url: `${STAFF_AUTH_BASE_PATH}/get-session`,
  headers: new Headers({ host: policy.expectedHost }),
  body: undefined,
  ...overrides,
});

describe("auth realm HTTP boundary", () => {
  it("rejects the wrong host, bearer headers, forwarded host, unsafe Origin and token query strings", async () => {
    const handled: Request[] = [];
    const fake = realm(handled);
    await expect(
      dispatchAuthRealmRequest(
        fake,
        policy,
        request({ headers: new Headers({ host: "portal.travelos.test" }) }),
      ),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      dispatchAuthRealmRequest(
        fake,
        policy,
        request({
          headers: new Headers({ host: policy.expectedHost, authorization: "Bearer synthetic" }),
        }),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      dispatchAuthRealmRequest(
        fake,
        policy,
        request({
          headers: new Headers({ host: policy.expectedHost, "x-forwarded-host": "evil.test" }),
        }),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      dispatchAuthRealmRequest(
        fake,
        policy,
        request({
          method: "POST",
          headers: new Headers({
            host: policy.expectedHost,
            origin: "http://portal.travelos.test",
          }),
        }),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      dispatchAuthRealmRequest(
        fake,
        policy,
        request({ url: `${STAFF_AUTH_BASE_PATH}/sign-in?token=synthetic` }),
      ),
    ).resolves.toMatchObject({ status: 403 });
    expect(handled).toHaveLength(0);
  });

  it("routes only the configured realm and preserves safe form bodies without parsing credentials", async () => {
    const handled: Request[] = [];
    const fake = realm(handled);
    await expect(
      dispatchAuthRealmRequest(
        fake,
        policy,
        request({ url: `${PORTAL_AUTH_BASE_PATH}/get-session` }),
      ),
    ).resolves.toMatchObject({ status: 404 });
    const result = await dispatchAuthRealmRequest(
      fake,
      policy,
      request({
        method: "POST",
        url: `${STAFF_AUTH_BASE_PATH}/sign-in/email`,
        headers: new Headers({
          host: policy.expectedHost,
          origin: policy.canonicalOrigin,
          "content-type": "application/x-www-form-urlencoded",
        }),
        body: { displayName: "synthetic-form-value", redirectTo: "/" },
      }),
    );
    expect(result.status).toBe(201);
    expect(new TextDecoder().decode(result.body)).toBe("accepted");
    expect(handled).toHaveLength(1);
    await expect(handled[0]?.text()).resolves.toBe(
      "displayName=synthetic-form-value&redirectTo=%2F",
    );
  });
});
