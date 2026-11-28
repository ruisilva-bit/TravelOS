import type { OpaqueId, QuoteView, StaffQuoteOperations } from "@travelos/backend-core";
import { asOpaqueId } from "@travelos/backend-core";
import {
  AdminIdempotencyKeySchema,
  AdminQuoteAddLineV1RequestSchema,
  AdminQuoteApplyMarginV1RequestSchema,
  AdminQuoteConvertedV1ResponseSchema,
  AdminQuoteCreateV1RequestSchema,
  AdminQuoteDayV1RequestSchema,
  AdminQuoteDeleteLineQuerySchema,
  AdminQuoteDetailV1ResponseSchema,
  AdminQuoteExpectedVersionV1RequestSchema,
  AdminQuoteHeaderPatchV1RequestSchema,
  AdminQuoteListQuerySchema,
  AdminQuoteListV1ResponseSchema,
  AdminQuoteReorderV1RequestSchema,
  AdminQuoteRevokedV1ResponseSchema,
  AdminQuoteSendV1RequestSchema,
  AdminQuoteSentV1ResponseSchema,
  AdminQuoteUpdateLineV1RequestSchema,
  AdminQuoteV1ResponseSchema,
  AdminLeadQuotesV1ResponseSchema,
} from "@travelos/contracts/admin";

import {
  idFrom,
  runHandler,
  send,
  surfaceRejectionStatus,
  badRequest,
  type AdminExpressApplication,
  type AdminRouteOptions,
  type HttpHandler,
  type IncomingHttpRequest,
  type OutgoingHttpResponse,
} from "./admin-route-http.js";
import { headerValues, headersFor } from "./request-boundary.js";

/** Thrown inside a quote route to end it with a status before any use case runs. */
class QuoteRouteReject extends Error {
  constructor(readonly status: 400 | 403 | 404) {
    super("quote route rejected");
  }
}

const reject = (status: 400 | 403 | 404): never => {
  throw new QuoteRouteReject(status);
};

/** Bigint and other non-JSON values become strings; dates are already ISO text. */
const serialize = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
};

/** Any Zod schema fits this shape; the route module does not depend on Zod directly. */
interface BodySchema<T> {
  safeParse(
    value: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

const parseBody = <T>(schema: BodySchema<T>, body: unknown): T => {
  const parsed = schema.safeParse(body ?? {});
  return parsed.success ? parsed.data : reject(400);
};

const idParam = (request: IncomingHttpRequest, name: string): OpaqueId =>
  idFrom(request.params?.[name]) ?? reject(400);

const noQuery = (request: IncomingHttpRequest): void => {
  if (Object.keys(request.query ?? {}).length > 0) reject(400);
};

const money = (value: string | undefined): bigint | undefined =>
  value === undefined ? undefined : BigInt(value);

/** Converts the admin line shape into the application's draft (money as bigint, absent kept absent). */
const lineDraft = (line: Record<string, unknown>) => ({
  ...line,
  netSupplierMinor: money(line["netSupplierMinor"] as string | undefined),
  recommendedMinor: money(line["recommendedMinor"] as string | undefined),
  pvpMinor: money(line["pvpMinor"] as string | undefined),
});

const quoteView = (view: QuoteView) => AdminQuoteDetailV1ResponseSchema.parse(serialize(view));

const requireOrigin = (request: IncomingHttpRequest, options: AdminRouteOptions): void => {
  const rejection = surfaceRejectionStatus(request, options.policy, true);
  if (rejection !== null) reject(rejection);
};

const readOnly = (request: IncomingHttpRequest, options: AdminRouteOptions): void => {
  const rejection = surfaceRejectionStatus(request, options.policy, false);
  if (rejection !== null) reject(rejection);
};

const cookieOf = (request: IncomingHttpRequest): unknown => headersFor(request).get("cookie");

/** Optional Idempotency-Key header: absent is fine, present but malformed is a bad request. */
const optionalIdempotencyKey = (request: IncomingHttpRequest): void => {
  const values = headerValues(
    {
      headers: request.headers,
      ...(request.rawHeaders ? { rawHeaders: request.rawHeaders } : {}),
    },
    "idempotency-key",
  );
  if (values.length > 1) reject(400);
  if (values.length === 1 && !AdminIdempotencyKeySchema.safeParse(values[0]).success) reject(400);
};

const handle =
  (
    work: (request: IncomingHttpRequest, response: OutgoingHttpResponse) => Promise<void>,
  ): HttpHandler =>
  (request, response, next) =>
    runHandler(
      async () => {
        try {
          await work(request, response);
        } catch (error) {
          if (error instanceof QuoteRouteReject) {
            if (error.status === 400) badRequest(response);
            else response.status(error.status).end();
            return;
          }
          throw error;
        }
      },
      response,
      next,
    );

export const registerAdminQuoteRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  if (options.quoteOperations === undefined) return;
  const operations: StaffQuoteOperations = options.quoteOperations;
  const remove = (path: string, handler: HttpHandler): void => {
    if (application.delete === undefined) throw new Error("Admin HTTP adapter must support DELETE");
    application.delete(path, handler);
  };

  application.get(
    "/api/admin/quotes",
    handle(async (request, response) => {
      readOnly(request, options);
      const query = parseBody(AdminQuoteListQuerySchema, request.query);
      const page = await operations.listQuotes(cookieOf(request), {
        limit: query.limit,
        cursor: query.cursor === undefined ? null : asOpaqueId(query.cursor),
        state: query.state ?? null,
        customerId: query.customerId === undefined ? null : asOpaqueId(query.customerId),
        leadId: query.leadId === undefined ? null : asOpaqueId(query.leadId),
        search: query.q === undefined || query.q === "" ? null : query.q,
      });
      send(
        response,
        200,
        AdminQuoteListV1ResponseSchema.parse(
          serialize({ items: page.items, nextCursor: page.nextCursor }),
        ),
      );
    }),
  );

  application.post(
    "/api/admin/quotes",
    handle(async (request, response) => {
      requireOrigin(request, options);
      optionalIdempotencyKey(request);
      const body = parseBody(AdminQuoteCreateV1RequestSchema, request.body);
      const { leadId, ...draft } = body;
      const created = await operations.createQuote(cookieOf(request), asOpaqueId(leadId), draft);
      send(response, 201, AdminQuoteV1ResponseSchema.parse(serialize(created)));
    }),
  );

  application.get(
    "/api/admin/quotes/:quoteId",
    handle(async (request, response) => {
      readOnly(request, options);
      noQuery(request);
      const quoteId = idParam(request, "quoteId");
      send(response, 200, quoteView(await operations.getQuote(cookieOf(request), quoteId)));
    }),
  );

  application.patch(
    "/api/admin/quotes/:quoteId",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const { expectedLockVersion, pvpOverrideMinor, ...patch } = parseBody(
        AdminQuoteHeaderPatchV1RequestSchema,
        request.body,
      );
      const view = await operations.updateQuote(cookieOf(request), quoteId, {
        expectedLockVersion: BigInt(expectedLockVersion),
        patch: {
          ...patch,
          pvpOverrideMinor: pvpOverrideMinor === null ? null : BigInt(pvpOverrideMinor),
        },
      });
      send(response, 200, quoteView(view));
    }),
  );

  application.post(
    "/api/admin/quotes/:quoteId/lines",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const { section, ...line } = parseBody(AdminQuoteAddLineV1RequestSchema, request.body);
      const view = await operations.addLine(cookieOf(request), quoteId, {
        section,
        line: lineDraft(line),
      });
      send(response, 201, quoteView(view));
    }),
  );

  application.patch(
    "/api/admin/quotes/:quoteId/lines/:lineId",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const lineId = idParam(request, "lineId");
      const { expectedLockVersion, ...line } = parseBody(
        AdminQuoteUpdateLineV1RequestSchema,
        request.body,
      );
      const view = await operations.updateLine(cookieOf(request), quoteId, lineId, {
        expectedLockVersion: BigInt(expectedLockVersion),
        line: lineDraft(line),
      });
      send(response, 200, quoteView(view));
    }),
  );

  remove(
    "/api/admin/quotes/:quoteId/lines/:lineId",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const lineId = idParam(request, "lineId");
      const query = parseBody(AdminQuoteDeleteLineQuerySchema, request.query);
      const view = await operations.deleteLine(
        cookieOf(request),
        quoteId,
        lineId,
        BigInt(query.expectedLockVersion),
      );
      send(response, 200, quoteView(view));
    }),
  );

  application.post(
    "/api/admin/quotes/:quoteId/lines/:lineId/duplicate",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const lineId = idParam(request, "lineId");
      send(
        response,
        201,
        quoteView(await operations.duplicateLine(cookieOf(request), quoteId, lineId)),
      );
    }),
  );

  application.put(
    "/api/admin/quotes/:quoteId/line-order",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const body = parseBody(AdminQuoteReorderV1RequestSchema, request.body);
      const view = await operations.reorderLines(cookieOf(request), quoteId, {
        expectedLockVersion: BigInt(body.expectedLockVersion),
        order: body.order.map((entry) => ({
          lineId: asOpaqueId(entry.lineId),
          section: entry.section,
        })),
      });
      send(response, 200, quoteView(view));
    }),
  );

  application.post(
    "/api/admin/quotes/:quoteId/apply-margin",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const body = parseBody(AdminQuoteApplyMarginV1RequestSchema, request.body);
      const view = await operations.applyTargetMargin(cookieOf(request), quoteId, {
        lineIds: body.lineIds === null ? null : body.lineIds.map((id) => asOpaqueId(id)),
        rounding: body.rounding,
      });
      send(response, 200, quoteView(view));
    }),
  );

  application.put(
    "/api/admin/quotes/:quoteId/days/:dayIndex",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const dayIndex = Number(request.params?.["dayIndex"]);
      if (!Number.isSafeInteger(dayIndex) || dayIndex < 0) reject(400);
      const body = parseBody(AdminQuoteDayV1RequestSchema, request.body);
      const view = await operations.upsertDay(cookieOf(request), quoteId, {
        expectedLockVersion: BigInt(body.expectedLockVersion),
        dayIndex,
        day: { title: body.title, description: body.description },
      });
      send(response, 200, quoteView(view));
    }),
  );

  remove(
    "/api/admin/quotes/:quoteId/days",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const query = parseBody(AdminQuoteDeleteLineQuerySchema, request.query);
      const view = await operations.resetDays(
        cookieOf(request),
        quoteId,
        BigInt(query.expectedLockVersion),
      );
      send(response, 200, quoteView(view));
    }),
  );

  application.post(
    "/api/admin/quotes/:quoteId/send",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const body = parseBody(AdminQuoteSendV1RequestSchema, request.body);
      const sent = await operations.sendQuote(cookieOf(request), quoteId, {
        expectedLockVersion: BigInt(body.expectedLockVersion),
        expiresAt: body.expiresAt,
      });
      send(response, 200, AdminQuoteSentV1ResponseSchema.parse(sent));
    }),
  );

  const transition = (
    path: string,
    run: (cookie: unknown, quoteId: OpaqueId, expectedLockVersion: bigint) => Promise<QuoteView>,
  ) =>
    application.post(
      path,
      handle(async (request, response) => {
        requireOrigin(request, options);
        const quoteId = idParam(request, "quoteId");
        const body = parseBody(AdminQuoteExpectedVersionV1RequestSchema, request.body);
        send(
          response,
          200,
          quoteView(await run(cookieOf(request), quoteId, BigInt(body.expectedLockVersion))),
        );
      }),
    );
  transition("/api/admin/quotes/:quoteId/revise", (cookie, id, version) =>
    operations.reviseQuote(cookie, id, version),
  );
  transition("/api/admin/quotes/:quoteId/decline", (cookie, id, version) =>
    operations.declineQuote(cookie, id, version),
  );
  transition("/api/admin/quotes/:quoteId/archive", (cookie, id, version) =>
    operations.archiveQuote(cookie, id, version),
  );

  application.post(
    "/api/admin/quote-share-links/:linkId/revoke",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const linkId = idParam(request, "linkId");
      await operations.revokeShareLink(cookieOf(request), linkId);
      send(response, 200, AdminQuoteRevokedV1ResponseSchema.parse({ revoked: true }));
    }),
  );

  application.post(
    "/api/admin/quotes/:quoteId/convert-to-trip",
    handle(async (request, response) => {
      requireOrigin(request, options);
      const quoteId = idParam(request, "quoteId");
      const converted = await operations.convertToTrip(cookieOf(request), quoteId);
      send(response, 200, AdminQuoteConvertedV1ResponseSchema.parse({ tripId: converted.tripId }));
    }),
  );

  application.get(
    "/api/admin/leads/:leadId/quotes",
    handle(async (request, response) => {
      readOnly(request, options);
      noQuery(request);
      const leadId = idParam(request, "leadId");
      const page = await operations.listQuotes(cookieOf(request), {
        limit: 100,
        cursor: null,
        state: null,
        customerId: null,
        leadId,
        search: null,
      });
      send(response, 200, AdminLeadQuotesV1ResponseSchema.parse(serialize({ items: page.items })));
    }),
  );
};
