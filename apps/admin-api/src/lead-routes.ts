import type { Lead } from "@travelos/backend-core";
import {
  ADMIN_IDEMPOTENCY_KEY_HEADER,
  AdminIdempotencyKeySchema,
  AdminLeadCreateV1RequestSchema,
  AdminLeadDisqualifyV1RequestSchema,
  AdminLeadListV1QuerySchema,
  AdminLeadListV1ResponseSchema,
  AdminLeadQualifyV1RequestSchema,
  AdminLeadUpdateV1RequestSchema,
  AdminLeadV1ResponseSchema,
} from "@travelos/contracts/admin";
import { asOpaqueId } from "@travelos/backend-core";

import {
  badRequest,
  idFrom,
  runHandler,
  send,
  surfaceRejectionStatus,
  type AdminExpressApplication,
  type AdminRouteOptions,
  type IncomingHttpRequest,
} from "./admin-route-http.js";
import { headersFor } from "./request-boundary.js";

const mapLead = (lead: Lead) =>
  AdminLeadV1ResponseSchema.parse({
    id: lead.id,
    agencyId: lead.agencyId,
    source: lead.source,
    contactGivenName: lead.contactGivenName,
    contactFamilyName: lead.contactFamilyName,
    contactEmail: lead.contactEmail,
    contactPhone: lead.contactPhone,
    internalNote: lead.internalNote,
    state: lead.state,
    qualifiedCustomerId: lead.qualifiedCustomerId,
    disqualificationReason: lead.disqualificationReason,
    lockVersion: lead.lockVersion.toString(),
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    closedAt: lead.closedAt,
  });

/** Absent header means "not idempotent"; a present but malformed header is a bad request. */
const idempotencyKeyFrom = (
  request: IncomingHttpRequest,
): { readonly valid: true; readonly key: string | null } | { readonly valid: false } => {
  const value = headersFor(request).get(ADMIN_IDEMPOTENCY_KEY_HEADER);
  if (value === null) return { valid: true, key: null };
  const parsed = AdminIdempotencyKeySchema.safeParse(value);
  return parsed.success ? { valid: true, key: parsed.data } : { valid: false };
};

export const registerAdminLeadRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  if (options.leadOperations === undefined) return;
  const leadOperations = options.leadOperations;

  application.get("/api/admin/leads", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminLeadListV1QuerySchema.safeParse(request.query ?? {});
        if (!parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, false);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const page = await leadOperations.listLeads(headersFor(request).get("cookie"), {
          limit: parsed.data.limit,
          cursor: parsed.data.cursor === null ? null : asOpaqueId(parsed.data.cursor),
          state: parsed.data.state,
        });
        send(
          response,
          200,
          AdminLeadListV1ResponseSchema.parse({
            items: page.items.map(mapLead),
            nextCursor: page.nextCursor,
          }),
        );
      },
      response,
      next,
    );
  });

  application.post("/api/admin/leads", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminLeadCreateV1RequestSchema.safeParse(request.body);
        const idempotency = idempotencyKeyFrom(request);
        if (!parsed.success || !idempotency.valid) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const lead = await leadOperations.createLead(headersFor(request).get("cookie"), {
          lead: parsed.data,
          idempotencyKey: idempotency.key,
        });
        send(response, 201, mapLead(lead));
      },
      response,
      next,
    );
  });

  application.get("/api/admin/leads/:leadId", (request, response, next) => {
    runHandler(
      async () => {
        const leadId = idFrom(request.params?.leadId);
        if (leadId === null || Object.keys(request.query ?? {}).length > 0) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, false);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const lead = await leadOperations.getLead(headersFor(request).get("cookie"), leadId);
        send(response, 200, mapLead(lead));
      },
      response,
      next,
    );
  });

  application.patch("/api/admin/leads/:leadId", (request, response, next) => {
    runHandler(
      async () => {
        const leadId = idFrom(request.params?.leadId);
        const parsed = AdminLeadUpdateV1RequestSchema.safeParse(request.body);
        if (leadId === null || !parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const { expectedLockVersion, ...lead } = parsed.data;
        const updated = await leadOperations.updateLead(headersFor(request).get("cookie"), leadId, {
          expectedLockVersion: BigInt(expectedLockVersion),
          lead,
        });
        send(response, 200, mapLead(updated));
      },
      response,
      next,
    );
  });

  application.post("/api/admin/leads/:leadId/qualification", (request, response, next) => {
    runHandler(
      async () => {
        const leadId = idFrom(request.params?.leadId);
        const parsed = AdminLeadQualifyV1RequestSchema.safeParse(request.body);
        const idempotency = idempotencyKeyFrom(request);
        if (leadId === null || !parsed.success || !idempotency.valid) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const body = parsed.data;
        const qualified = await leadOperations.qualifyLead(
          headersFor(request).get("cookie"),
          leadId,
          {
            expectedLockVersion: BigInt(body.expectedLockVersion),
            mode:
              body.mode === "LINK_CUSTOMER"
                ? { kind: "LINK_CUSTOMER", customerId: asOpaqueId(body.customerId) }
                : {
                    kind: "CREATE_CUSTOMER",
                    customerDisplayName: body.customerDisplayName ?? null,
                  },
            idempotencyKey: idempotency.key,
          },
        );
        send(response, 200, mapLead(qualified));
      },
      response,
      next,
    );
  });

  application.post("/api/admin/leads/:leadId/disqualification", (request, response, next) => {
    runHandler(
      async () => {
        const leadId = idFrom(request.params?.leadId);
        const parsed = AdminLeadDisqualifyV1RequestSchema.safeParse(request.body);
        const idempotency = idempotencyKeyFrom(request);
        if (leadId === null || !parsed.success || !idempotency.valid) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const disqualified = await leadOperations.disqualifyLead(
          headersFor(request).get("cookie"),
          leadId,
          {
            expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
            reason: parsed.data.reason,
            idempotencyKey: idempotency.key,
          },
        );
        send(response, 200, mapLead(disqualified));
      },
      response,
      next,
    );
  });
};
