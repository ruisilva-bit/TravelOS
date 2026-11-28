import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ShareLinkNotFoundError,
  type PublicQuoteOperations,
  type PublicShareOperations,
} from "@travelos/backend-core";

import { createAdminApi } from "../src/app.js";
import {
  PROPOSAL_CONTENT_SECURITY_POLICY,
  PUBLIC_SHARE_HEADERS,
} from "../src/public-share-routes.js";
import { createStaffInvitationRateLimiter } from "../src/staff-invitation-rate-limit.js";
import { SHARE_NOT_FOUND_HTML } from "../src/share-page-renderer.js";

const expectedHost = "admin.example.test";
const canonicalOrigin = "https://admin.example.test";
const validToken = `${"V".repeat(42)}A`;
const otherToken = `${"W".repeat(42)}A`;

const money = (minorUnits: string) => ({ minorUnits, currency: "EUR", scale: 2 });

const proposal = (overrides: { title?: string; extra?: Record<string, unknown> } = {}) => ({
  schemaVersion: 1,
  agency: { displayName: "Agência Teste" },
  quote: {
    number: "ORC-2026-0001",
    title: overrides.title ?? "Açores",
    destination: "Açores",
    intro: null,
    heroImageUrl: null,
    startDate: "2027-05-01",
    endDate: "2027-05-08",
    nights: 7,
    adults: 2,
    children: 0,
    currency: "EUR",
    validUntil: "2099-12-31",
  },
  totals: {
    pvpFinal: money("250000"),
    perPerson: money("125000"),
    deposit: money("75000"),
    balance: money("175000"),
    balanceDueDate: "2027-03-17",
  },
  flights: [],
  accommodations: [],
  otherServices: [],
  days: [],
  options: [],
  included: [],
  excluded: [],
  ...(overrides.extra ?? {}),
});

const view = (overrides: Record<string, unknown> = {}) => ({
  payload: proposal(),
  isLatest: true,
  state: "SENT",
  validUntil: "2099-12-31",
  expired: false,
  accepted: null,
  ...overrides,
});

const tripOps = (): PublicShareOperations => ({
  readPublicShare: vi.fn(() => Promise.reject(new ShareLinkNotFoundError())),
});

const quoteOps = (): { [Key in keyof PublicQuoteOperations]: ReturnType<typeof vi.fn> } => ({
  readPublicQuote: vi.fn(),
  acceptPublicQuote: vi.fn(),
});

const open = async (
  quote: PublicQuoteOperations | undefined,
  options: { maxAttempts?: number; trip?: PublicShareOperations; origin?: boolean } = {},
) =>
  createAdminApi({
    expectedHost,
    publicShare: {
      operations: options.trip ?? tripOps(),
      rateLimiter: createStaffInvitationRateLimiter({
        maxAttempts: options.maxAttempts ?? 1_000,
        windowMs: 60_000,
      }),
      ...(quote === undefined ? {} : { quoteOperations: quote }),
      ...(options.origin === false ? {} : { canonicalOrigin }),
    },
  });

afterEach(() => vi.restoreAllMocks());

describe("public proposal GET /v/:token", () => {
  it("serves the quote proposal with its own CSP and the shared hardened headers", async () => {
    const quote = quoteOps();
    quote.readPublicQuote.mockResolvedValue(view());
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const response = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(response.headers["content-security-policy"]).toBe(PROPOSAL_CONTENT_SECURITY_POLICY);
      for (const [name, value] of Object.entries(PUBLIC_SHARE_HEADERS)) {
        if (name === "Content-Security-Policy") continue;
        expect(response.headers[name.toLowerCase()]).toBe(value);
      }
      expect(response.text).toContain("Açores");
      expect(quote.readPublicQuote).toHaveBeenCalledWith(validToken, expect.any(String));
    } finally {
      await application.close();
    }
  });

  it("escapes customer-visible text and never renders script", async () => {
    const quote = quoteOps();
    quote.readPublicQuote.mockResolvedValue(
      view({ payload: proposal({ title: "<script>x</script>" }) }),
    );
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const response = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      expect(response.text).not.toContain("<script>");
      expect(response.text).toContain("&lt;script&gt;");
    } finally {
      await application.close();
    }
  });

  it("answers unknown, malformed and contract-violating quotes with the same 404 as a missing trip", async () => {
    const quote = quoteOps();
    quote.readPublicQuote.mockRejectedValue(new Error("not found"));
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const unknown = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(404);
      const malformed = await request(application.getHttpServer())
        .get("/v/short")
        .set("Host", expectedHost)
        .expect(404);
      expect(unknown.text).toBe(SHARE_NOT_FOUND_HTML);
      expect(malformed.text).toBe(SHARE_NOT_FOUND_HTML);
    } finally {
      await application.close();
    }

    const leaking = quoteOps();
    leaking.readPublicQuote.mockResolvedValue(
      view({ payload: proposal({ extra: { supplier: "SEGREDO" } }) }),
    );
    const strict = await open(leaking as unknown as PublicQuoteOperations);
    try {
      const response = await request(strict.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(404);
      expect(response.text).toBe(SHARE_NOT_FOUND_HTML);
      expect(response.text).not.toContain("SEGREDO");
    } finally {
      await strict.close();
    }
  });

  it("falls back to 404 when no quote operations are composed", async () => {
    const application = await open(undefined);
    try {
      const response = await request(application.getHttpServer())
        .get(`/v/${otherToken}`)
        .set("Host", expectedHost)
        .expect(404);
      expect(response.text).toBe(SHARE_NOT_FOUND_HTML);
    } finally {
      await application.close();
    }
  });

  it("says a superseded proposal was updated and shows no form", async () => {
    const quote = quoteOps();
    quote.readPublicQuote.mockResolvedValue(view({ isLatest: false }));
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const response = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      expect(response.text).toContain("foi atualizada");
      expect(response.text).not.toContain('action="/v/');
    } finally {
      await application.close();
    }
  });

  it("shows the accepted name escaped and no form after acceptance", async () => {
    const quote = quoteOps();
    quote.readPublicQuote.mockResolvedValue(
      view({ accepted: { name: "<b>Ana</b>", at: "2026-11-28T10:00:00.000Z" } }),
    );
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const response = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      expect(response.text).toContain("&lt;b&gt;Ana&lt;/b&gt;");
      expect(response.text).not.toContain("<b>Ana</b>");
      expect(response.text).not.toContain('action="/v/');
    } finally {
      await application.close();
    }
  });

  it("hides the form for an expired proposal", async () => {
    const quote = quoteOps();
    quote.readPublicQuote.mockResolvedValue(view({ expired: true }));
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const response = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      expect(response.text).not.toContain('action="/v/');
      expect(response.text).toContain("já não está disponível");
    } finally {
      await application.close();
    }
  });

  it("shows the form only for the latest sent, unaccepted proposal and maps flash parameters", async () => {
    const quote = quoteOps();
    quote.readPublicQuote.mockResolvedValue(view());
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const open1 = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      expect(open1.text).toContain(`action="/v/${validToken}/accept"`);
      const accepted = await request(application.getHttpServer())
        .get(`/v/${validToken}?aceite=1`)
        .set("Host", expectedHost)
        .expect(200);
      expect(accepted.text).toContain("Proposta aceite. Obrigado!");
      const failed = await request(application.getHttpServer())
        .get(`/v/${validToken}?erro=1`)
        .set("Host", expectedHost)
        .expect(200);
      expect(failed.text).toContain("Não foi possível registar o aceite");
    } finally {
      await application.close();
    }
  });

  it("rate limits every outcome with the same constant 404 body", async () => {
    const quote = quoteOps();
    quote.readPublicQuote.mockResolvedValue(view());
    const application = await open(quote as unknown as PublicQuoteOperations, { maxAttempts: 1 });
    try {
      await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      const limited = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(429);
      expect(limited.text).toBe(SHARE_NOT_FOUND_HTML);
      expect(limited.headers["retry-after"]).toBeDefined();
    } finally {
      await application.close();
    }
  });
});

describe("public proposal POST /v/:token/accept", () => {
  const accept = (
    application: Awaited<ReturnType<typeof open>>,
    body: string,
    headers: Record<string, string> = {},
  ) =>
    request(application.getHttpServer())
      .post(`/v/${validToken}/accept`)
      .set("Host", expectedHost)
      .set("Origin", canonicalOrigin)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set(headers)
      .send(body);

  it("accepts, redirects with a success flag and passes the trimmed name through", async () => {
    const quote = quoteOps();
    quote.acceptPublicQuote.mockResolvedValue("ACCEPTED");
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const response = await accept(application, "name=Ana%20Silva&confirm=on").expect(303);
      expect(response.headers["location"]).toBe(`/v/${validToken}?aceite=1`);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(quote.acceptPublicQuote).toHaveBeenCalledWith(validToken, "Ana Silva");
    } finally {
      await application.close();
    }
  });

  it("treats a repeated acceptance as success and superseded or unavailable as a plain return", async () => {
    const quote = quoteOps();
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      quote.acceptPublicQuote.mockResolvedValueOnce("ALREADY_ACCEPTED");
      const again = await accept(application, "name=Ana&confirm=on").expect(303);
      expect(again.headers["location"]).toBe(`/v/${validToken}?aceite=1`);
      quote.acceptPublicQuote.mockResolvedValueOnce("SUPERSEDED");
      const superseded = await accept(application, "name=Ana&confirm=on").expect(303);
      expect(superseded.headers["location"]).toBe(`/v/${validToken}`);
      quote.acceptPublicQuote.mockResolvedValueOnce("UNAVAILABLE");
      const unavailable = await accept(application, "name=Ana&confirm=on").expect(303);
      expect(unavailable.headers["location"]).toBe(`/v/${validToken}`);
    } finally {
      await application.close();
    }
  });

  it("sends invalid input back with the error flag without calling the use case", async () => {
    const quote = quoteOps();
    quote.acceptPublicQuote.mockRejectedValue(new Error("Nome de aceitação inválido"));
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const noConfirm = await accept(application, "name=Ana").expect(303);
      expect(noConfirm.headers["location"]).toBe(`/v/${validToken}?erro=1`);
      const badName = await accept(application, "name=A&confirm=on").expect(303);
      expect(badName.headers["location"]).toBe(`/v/${validToken}?erro=1`);
      const json = await request(application.getHttpServer())
        .post(`/v/${validToken}/accept`)
        .set("Host", expectedHost)
        .set("Origin", canonicalOrigin)
        .set("Content-Type", "application/json")
        .send({ name: "Ana", confirm: "on" })
        .expect(303);
      expect(json.headers["location"]).toBe(`/v/${validToken}?erro=1`);
      expect(quote.acceptPublicQuote).toHaveBeenCalledTimes(1);
    } finally {
      await application.close();
    }
  });

  it("rejects bodies over 2 KB before parsing them", async () => {
    const quote = quoteOps();
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      const response = await accept(
        application,
        `name=Ana&confirm=on&pad=${"x".repeat(3_000)}`,
      ).expect(303);
      expect(response.headers["location"]).toBe(`/v/${validToken}?erro=1`);
      expect(quote.acceptPublicQuote).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("refuses a foreign Origin or Referer with 403 and never accepts", async () => {
    const quote = quoteOps();
    const application = await open(quote as unknown as PublicQuoteOperations);
    try {
      await accept(application, "name=Ana&confirm=on", {
        Origin: "https://evil.example.test",
      }).expect(403);
      await accept(application, "name=Ana&confirm=on", {
        Origin: canonicalOrigin,
        Referer: "https://evil.example.test/page",
      }).expect(403);
      expect(quote.acceptPublicQuote).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("does not accept at all when no canonical origin is configured", async () => {
    const quote = quoteOps();
    const application = await open(quote as unknown as PublicQuoteOperations, { origin: false });
    try {
      await accept(application, "name=Ana&confirm=on").expect(403);
      expect(quote.acceptPublicQuote).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("keeps the rate limit on the accept route", async () => {
    const quote = quoteOps();
    quote.acceptPublicQuote.mockResolvedValue("ACCEPTED");
    const application = await open(quote as unknown as PublicQuoteOperations, { maxAttempts: 1 });
    try {
      await accept(application, "name=Ana&confirm=on").expect(303);
      const limited = await accept(application, "name=Ana&confirm=on").expect(429);
      expect(limited.text).toBe(SHARE_NOT_FOUND_HTML);
    } finally {
      await application.close();
    }
  });
});
