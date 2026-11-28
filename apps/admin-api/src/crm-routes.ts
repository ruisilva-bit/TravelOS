import type {
  CrmCustomerDetail,
  CrmCustomerPerson,
  CrmCustomerSummary,
  CrmLeadSummary,
  CrmPersonRecord,
  CrmSearchResult,
  CrmTripSummary,
  StaffCrmOperations,
} from "@travelos/backend-core";
import {
  ADMIN_IDEMPOTENCY_KEY_HEADER,
  AdminCustomerCreateV1RequestSchema,
  AdminCustomerDetailV1ResponseSchema,
  AdminCustomerListV1QuerySchema,
  AdminCustomerListV1ResponseSchema,
  AdminCustomerRolesV1RequestSchema,
  AdminCustomerSummaryV1ResponseSchema,
  AdminCustomerUpdateV1RequestSchema,
  AdminIdempotencyKeySchema,
  AdminPersonCreateV1RequestSchema,
  AdminPersonUpdateV1RequestSchema,
  AdminPersonV1ResponseSchema,
  AdminSearchV1QuerySchema,
  AdminSearchV1ResponseSchema,
  AdminCustomerPersonV1ResponseSchema,
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

const mapPerson = (person: CrmPersonRecord) =>
  AdminPersonV1ResponseSchema.parse({
    id: person.id,
    agencyId: person.agencyId,
    givenName: person.givenName,
    familyName: person.familyName,
    email: person.email,
    phone: person.phone,
    nationality: person.nationality,
    notes: person.notes,
    birthDate: person.birthDate,
    passportNumber: person.passportNumber,
    passportExpiry: person.passportExpiry,
    lockVersion: person.lockVersion.toString(),
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
  });

const mapCustomerPerson = (person: CrmCustomerPerson) =>
  AdminCustomerPersonV1ResponseSchema.parse({
    ...mapPerson(person),
    roles: [...person.roles],
    isPrimary: person.isPrimary,
  });

const mapSummary = (customer: CrmCustomerSummary) =>
  AdminCustomerSummaryV1ResponseSchema.parse({
    id: customer.id,
    agencyId: customer.agencyId,
    displayName: customer.displayName,
    email: customer.email,
    phone: customer.phone,
    primaryContactName: customer.primaryContactName,
    peopleCount: customer.peopleCount,
    lockVersion: customer.lockVersion.toString(),
    updatedAt: customer.updatedAt,
  });

const mapLeadSummary = (lead: CrmLeadSummary) => ({
  id: lead.id,
  name: lead.name,
  state: lead.state,
});

const mapTripSummary = (trip: CrmTripSummary) => ({
  id: trip.id,
  title: trip.title,
  startDate: trip.startDate,
  endDate: trip.endDate,
  state: trip.state,
});

const mapDetail = (detail: CrmCustomerDetail) =>
  AdminCustomerDetailV1ResponseSchema.parse({
    id: detail.id,
    agencyId: detail.agencyId,
    displayName: detail.displayName,
    email: detail.email,
    phone: detail.phone,
    notes: detail.notes,
    lockVersion: detail.lockVersion.toString(),
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    people: detail.people.map(mapCustomerPerson),
    canViewSensitive: detail.canViewSensitive,
    leads: detail.leads.map(mapLeadSummary),
    trips: detail.trips.map(mapTripSummary),
  });

const mapSearch = (result: CrmSearchResult) =>
  AdminSearchV1ResponseSchema.parse({
    customers: result.customers.map(mapSummary),
    leads: result.leads.map(mapLeadSummary),
    trips: result.trips.map(mapTripSummary),
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

export const registerAdminCrmRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  if (options.crmOperations === undefined) return;
  const crmOperations: StaffCrmOperations = options.crmOperations;

  application.get("/api/admin/customers", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminCustomerListV1QuerySchema.safeParse(request.query ?? {});
        if (!parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, false);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const page = await crmOperations.listCustomers(headersFor(request).get("cookie"), {
          limit: parsed.data.limit,
          cursor: parsed.data.cursor === null ? null : asOpaqueId(parsed.data.cursor),
          query: parsed.data.q,
        });
        send(
          response,
          200,
          AdminCustomerListV1ResponseSchema.parse({
            items: page.items.map(mapSummary),
            nextCursor: page.nextCursor,
          }),
        );
      },
      response,
      next,
    );
  });

  application.post("/api/admin/customers", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminCustomerCreateV1RequestSchema.safeParse(request.body);
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
        const body = parsed.data;
        const detail = await crmOperations.createCustomer(headersFor(request).get("cookie"), {
          customer: {
            displayName: body.displayName,
            email: body.email,
            phone: body.phone,
            notes: body.notes,
          },
          primaryPerson: { ...body.primaryPerson },
          idempotencyKey: idempotency.key,
        });
        send(response, 201, mapDetail(detail));
      },
      response,
      next,
    );
  });

  application.get("/api/admin/customers/:customerId", (request, response, next) => {
    runHandler(
      async () => {
        const customerId = idFrom(request.params?.customerId);
        if (customerId === null || Object.keys(request.query ?? {}).length > 0) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, false);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const detail = await crmOperations.getCustomer(
          headersFor(request).get("cookie"),
          customerId,
        );
        send(response, 200, mapDetail(detail));
      },
      response,
      next,
    );
  });

  application.patch("/api/admin/customers/:customerId", (request, response, next) => {
    runHandler(
      async () => {
        const customerId = idFrom(request.params?.customerId);
        const parsed = AdminCustomerUpdateV1RequestSchema.safeParse(request.body);
        if (customerId === null || !parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const { expectedLockVersion, ...customer } = parsed.data;
        const updated = await crmOperations.updateCustomer(
          headersFor(request).get("cookie"),
          customerId,
          { expectedLockVersion: BigInt(expectedLockVersion), customer },
        );
        send(response, 200, mapDetail(updated));
      },
      response,
      next,
    );
  });

  application.post("/api/admin/customers/:customerId/persons", (request, response, next) => {
    runHandler(
      async () => {
        const customerId = idFrom(request.params?.customerId);
        const parsed = AdminPersonCreateV1RequestSchema.safeParse(request.body);
        if (customerId === null || !parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const { roles, ...person } = parsed.data;
        const detail = await crmOperations.addPerson(
          headersFor(request).get("cookie"),
          customerId,
          {
            person,
            roles,
          },
        );
        send(response, 201, mapDetail(detail));
      },
      response,
      next,
    );
  });

  application.patch("/api/admin/persons/:personId", (request, response, next) => {
    runHandler(
      async () => {
        const personId = idFrom(request.params?.personId);
        const parsed = AdminPersonUpdateV1RequestSchema.safeParse(request.body);
        if (personId === null || !parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const { expectedLockVersion, birthDate, passportNumber, passportExpiry, ...details } =
          parsed.data;
        // Omitted sensitive keys are left out entirely so the stored values stay unchanged.
        const person = {
          ...details,
          ...(birthDate === undefined ? {} : { birthDate }),
          ...(passportNumber === undefined ? {} : { passportNumber }),
          ...(passportExpiry === undefined ? {} : { passportExpiry }),
        };
        const updated = await crmOperations.updatePerson(
          headersFor(request).get("cookie"),
          personId,
          {
            expectedLockVersion: BigInt(expectedLockVersion),
            person,
          },
        );
        send(response, 200, mapPerson(updated));
      },
      response,
      next,
    );
  });

  application.put(
    "/api/admin/customers/:customerId/persons/:personId/roles",
    (request, response, next) => {
      runHandler(
        async () => {
          const customerId = idFrom(request.params?.customerId);
          const personId = idFrom(request.params?.personId);
          const parsed = AdminCustomerRolesV1RequestSchema.safeParse(request.body);
          if (customerId === null || personId === null || !parsed.success) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const detail = await crmOperations.setPersonRoles(
            headersFor(request).get("cookie"),
            customerId,
            personId,
            { roles: parsed.data.roles, isPrimary: parsed.data.isPrimary },
          );
          send(response, 200, mapDetail(detail));
        },
        response,
        next,
      );
    },
  );

  application.get("/api/admin/search", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminSearchV1QuerySchema.safeParse(request.query ?? {});
        if (!parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, false);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const result = await crmOperations.search(headersFor(request).get("cookie"), parsed.data.q);
        send(response, 200, mapSearch(result));
      },
      response,
      next,
    );
  });
};
