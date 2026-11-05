import {
  asOpaqueId,
  M1InputValidationError,
  M1RuntimeAcceptanceFixtureConflictError,
  M1RuntimeAcceptanceFixtureNotFoundError,
  M1OptimisticConflictError,
  M1TransactionConflictError,
  M1StaffAuthorizationError,
  M1StaffPublicationInputError,
  type M1StaffTripWorkspaceWriteOperations,
  M1TripNotFoundError,
  StalePublicationCandidateError,
  IdempotencyConflictError,
  TripPublicationNotFoundError,
  M1StaffTripAccessNotFoundError,
  createMoney,
  moneyToJson,
  type M1StaffTripAccessOperations,
  type M1StaffTripOperations,
  type M1StaffTripWorkspaceOperations,
  type M1StaffTripPublicationOperations,
  type M1RuntimeAcceptanceFixtureOperations,
  type M1TripSlice,
  type M1TripWorkspace,
} from "@travelos/backend-core";
import {
  ADMIN_RUNTIME_ACCEPTANCE_FIXTURE_RUN_HEADER,
  AdminAccommodationUpdateRequestSchema,
  AdminCreateM1TripSliceRequestSchema,
  AdminM1TripSliceResponseSchema,
  AdminRuntimeAcceptanceCleanupV1ResponseSchema,
  AdminRuntimeAcceptanceFixtureCleanupV1RequestSchema,
  AdminRuntimeAcceptanceFixtureConflictV1ResponseSchema,
  AdminSupplierCostNoteUpdateRequestSchema,
  AdminPublishTripV1RequestSchema,
  AdminTripPublicationHistoryV1ResponseSchema,
  AdminTripPublicationPreviewV1Schema,
  AdminTripPublicationV1ResponseSchema,
  AdminTripWorkspaceCreateV1RequestSchema,
  AdminTripWorkspaceListV1QuerySchema,
  AdminTripWorkspaceListV1ResponseSchema,
  AdminTripWorkspaceV1ResponseSchema,
  AdminTripWorkspaceFlightCreateV1RequestSchema,
  AdminTripWorkspaceFlightUpdateV1RequestSchema,
  AdminTripWorkspaceAccommodationCreateV1RequestSchema,
  AdminTripWorkspaceAccommodationUpdateV1RequestSchema,
  AdminTripWorkspaceTripUpdateV1RequestSchema,
  AdminTripAccessGrantIssueV1RequestSchema,
  AdminTripAccessGrantRevokeV1RequestSchema,
  AdminTripAccessGrantV1ResponseSchema,
  type AdminCreateM1TripSliceRequest,
  type AdminTripWorkspaceFlightCreateV1Request,
  type AdminTripWorkspaceAccommodationCreateV1Request,
  type AdminTripWorkspaceTripUpdateV1Request,
  type AdminTripWorkspaceCreateV1Request,
} from "@travelos/contracts/admin";
import { hostHeaderMatchesExpectedHost, type AuthSurfacePolicy } from "@travelos/auth-adapters";

import { ADMIN_PRIVATE_NO_STORE } from "./http-security.js";

interface IncomingHttpRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly params?: Readonly<Record<string, string | undefined>>;
  readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

interface OutgoingHttpResponse {
  status(statusCode: number): OutgoingHttpResponse;
  setHeader(name: string, value: string | readonly string[]): void;
  end(body?: Uint8Array): void;
  json(body: unknown): void;
}

type Next = (error?: unknown) => void;
type HttpHandler = (
  request: IncomingHttpRequest,
  response: OutgoingHttpResponse,
  next: Next,
) => void;

export interface AdminM1ExpressApplication {
  get(path: string, handler: HttpHandler): void;
  post(path: string, handler: HttpHandler): void;
  patch(path: string, handler: HttpHandler): void;
}

export interface AdminM1RouteOptions {
  readonly policy: AuthSurfacePolicy;
  readonly m1Operations: M1StaffTripOperations;
  readonly m1WorkspaceOperations?: M1StaffTripWorkspaceOperations;
  readonly m1WorkspaceWriteOperations?: M1StaffTripWorkspaceWriteOperations;
  readonly m1TripAccessOperations?: M1StaffTripAccessOperations;
  readonly m1PublicationOperations?: M1StaffTripPublicationOperations;
  readonly runtimeAcceptanceFixtureOperations?: AdminRuntimeAcceptanceFixtureRouteOperations;
}

export interface AdminRuntimeAcceptanceFixtureRouteOperations {
  readonly createFixtureTrip: M1StaffTripOperations["createRuntimeAcceptanceFixtureTrip"];
  readonly cleanupFixture: M1RuntimeAcceptanceFixtureOperations["cleanupFixture"];
}

const headersFor = (request: IncomingHttpRequest): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(
      name,
      Array.isArray(value) ? value.join(name.toLowerCase() === "cookie" ? "; " : ", ") : value,
    );
  }
  return headers;
};

const routeUrlFor = (request: IncomingHttpRequest, policy: AuthSurfacePolicy): URL | null => {
  try {
    const origin = new URL(policy.canonicalOrigin);
    const target = new URL(request.originalUrl ?? request.url, origin);
    return target.origin === origin.origin ? target : null;
  } catch {
    return null;
  }
};

const surfaceRejectionStatus = (
  request: IncomingHttpRequest,
  policy: AuthSurfacePolicy,
  requireCanonicalOrigin: boolean,
): 403 | 404 | null => {
  const headers = headersFor(request);
  if (routeUrlFor(request, policy) === null) return 404;
  if (!hostHeaderMatchesExpectedHost(headers.get("host"), policy.expectedHost)) return 404;
  const forwardedHost = headers.get("x-forwarded-host");
  if (
    headers.has("authorization") ||
    (requireCanonicalOrigin && headers.get("origin") !== policy.canonicalOrigin) ||
    (forwardedHost !== null && !hostHeaderMatchesExpectedHost(forwardedHost, policy.expectedHost))
  ) {
    return 403;
  }
  return null;
};

const send = (response: OutgoingHttpResponse, status: number, body: unknown): void => {
  response.status(status).json(body);
};

const badRequest = (response: OutgoingHttpResponse): void =>
  send(response, 400, { error: "invalid_request" });

const idFrom = (value: string | undefined): ReturnType<typeof asOpaqueId> | null => {
  if (value === undefined) return null;
  try {
    return asOpaqueId(value);
  } catch {
    return null;
  }
};

const mapSlice = (slice: M1TripSlice) =>
  AdminM1TripSliceResponseSchema.parse({
    person: {
      id: slice.person.id,
      agencyId: slice.person.agencyId,
      givenName: slice.person.givenName,
      familyName: slice.person.familyName,
      email: slice.person.email,
      lockVersion: slice.person.lockVersion.toString(),
    },
    customer: {
      id: slice.customer.id,
      agencyId: slice.customer.agencyId,
      displayName: slice.customer.displayName,
      lockVersion: slice.customer.lockVersion.toString(),
    },
    customerPerson: {
      agencyId: slice.customerPerson.agencyId,
      customerId: slice.customerPerson.customerId,
      personId: slice.customerPerson.personId,
      role: slice.customerPerson.role,
      isPrimary: slice.customerPerson.isPrimary,
    },
    traveller: {
      id: slice.traveller.id,
      agencyId: slice.traveller.agencyId,
      tripId: slice.traveller.tripId,
      personId: slice.traveller.personId,
      role: slice.traveller.role,
    },
    trip: {
      id: slice.trip.id,
      agencyId: slice.trip.agencyId,
      title: slice.trip.title,
      startDate: slice.trip.startDate,
      endDate: slice.trip.endDate,
      state: slice.trip.state,
      workspaceRevision: slice.trip.workspaceRevision.toString(),
      lockVersion: slice.trip.lockVersion.toString(),
    },
    flights: slice.flights.map((flight) => ({
      id: flight.id,
      agencyId: flight.agencyId,
      tripId: flight.tripId,
      family: flight.family,
      state: flight.state,
      sortOrder: flight.sortOrder,
      title: flight.title,
      description: flight.description,
      customerBookingReference: flight.customerBookingReference,
      lockVersion: flight.lockVersion.toString(),
      carrier: flight.carrier,
      flightNumber: flight.flightNumber,
      departureAirport: flight.departureAirport,
      arrivalAirport: flight.arrivalAirport,
      departure: {
        localDate: flight.departure.localDate,
        localTime: flight.departure.localTime,
        timezoneName: flight.departure.timezoneName,
        instant: flight.departure.instant,
      },
      arrival: {
        localDate: flight.arrival.localDate,
        localTime: flight.arrival.localTime,
        timezoneName: flight.arrival.timezoneName,
        instant: flight.arrival.instant,
      },
      terminal: flight.terminal,
      cabin: flight.cabin,
      baggage: flight.baggage,
      seat: flight.seat,
    })),
    accommodations: slice.accommodations.map((accommodation) => ({
      id: accommodation.id,
      agencyId: accommodation.agencyId,
      tripId: accommodation.tripId,
      family: accommodation.family,
      state: accommodation.state,
      sortOrder: accommodation.sortOrder,
      title: accommodation.title,
      description: accommodation.description,
      customerBookingReference: accommodation.customerBookingReference,
      lockVersion: accommodation.lockVersion.toString(),
      propertyName: accommodation.propertyName,
      checkIn: {
        localDate: accommodation.checkIn.localDate,
        localTime: accommodation.checkIn.localTime,
        timezoneName: accommodation.checkIn.timezoneName,
        instant: accommodation.checkIn.instant,
      },
      checkOut: {
        localDate: accommodation.checkOut.localDate,
        localTime: accommodation.checkOut.localTime,
        timezoneName: accommodation.checkOut.timezoneName,
        instant: accommodation.checkOut.instant,
      },
      roomDescription: accommodation.roomDescription,
      boardType: accommodation.boardType,
    })),
    reservations: slice.reservations.map((reservation) => ({
      id: reservation.id,
      agencyId: reservation.agencyId,
      tripId: reservation.tripId,
      supplierName: reservation.supplierName,
      supplierReference: reservation.supplierReference,
      customerBookingReference: reservation.customerBookingReference,
      state: reservation.state,
      lockVersion: reservation.lockVersion.toString(),
    })),
    reservationItemLinks: slice.reservationItemLinks.map((link) => ({
      agencyId: link.agencyId,
      tripId: link.tripId,
      reservationId: link.reservationId,
      itineraryItemId: link.itineraryItemId,
      linkRole: link.linkRole,
    })),
    supplierCosts: slice.supplierCosts.map((supplierCost) => ({
      id: supplierCost.id,
      agencyId: supplierCost.agencyId,
      tripId: supplierCost.tripId,
      reservationId: supplierCost.reservationId,
      amount: moneyToJson(supplierCost.amount),
      internalNote: supplierCost.internalNote,
      classification: supplierCost.classification,
      lockVersion: supplierCost.lockVersion.toString(),
    })),
  });

const mapTripWorkspaceTrip = (trip: M1TripWorkspace["trip"]) => ({
  id: trip.id,
  agencyId: trip.agencyId,
  title: trip.title,
  startDate: trip.startDate,
  endDate: trip.endDate,
  state: trip.state,
  workspaceRevision: trip.workspaceRevision.toString(),
  lockVersion: trip.lockVersion.toString(),
});

const mapTripWorkspace = (workspace: M1TripWorkspace) =>
  AdminTripWorkspaceV1ResponseSchema.parse({
    trip: mapTripWorkspaceTrip(workspace.trip),
    flights: workspace.flights.map((flight) => ({
      id: flight.id,
      agencyId: flight.agencyId,
      tripId: flight.tripId,
      family: flight.family,
      state: flight.state,
      sortOrder: flight.sortOrder,
      title: flight.title,
      description: flight.description,
      customerBookingReference: flight.customerBookingReference,
      lockVersion: flight.lockVersion.toString(),
      carrier: flight.carrier,
      flightNumber: flight.flightNumber,
      departureAirport: flight.departureAirport,
      arrivalAirport: flight.arrivalAirport,
      departure: {
        localDate: flight.departure.localDate,
        localTime: flight.departure.localTime,
        timezoneName: flight.departure.timezoneName,
        instant: flight.departure.instant,
      },
      arrival: {
        localDate: flight.arrival.localDate,
        localTime: flight.arrival.localTime,
        timezoneName: flight.arrival.timezoneName,
        instant: flight.arrival.instant,
      },
      terminal: flight.terminal,
      cabin: flight.cabin,
      baggage: flight.baggage,
      seat: flight.seat,
    })),
    accommodations: workspace.accommodations.map((accommodation) => ({
      id: accommodation.id,
      agencyId: accommodation.agencyId,
      tripId: accommodation.tripId,
      family: accommodation.family,
      state: accommodation.state,
      sortOrder: accommodation.sortOrder,
      title: accommodation.title,
      description: accommodation.description,
      customerBookingReference: accommodation.customerBookingReference,
      lockVersion: accommodation.lockVersion.toString(),
      propertyName: accommodation.propertyName,
      checkIn: {
        localDate: accommodation.checkIn.localDate,
        localTime: accommodation.checkIn.localTime,
        timezoneName: accommodation.checkIn.timezoneName,
        instant: accommodation.checkIn.instant,
      },
      checkOut: {
        localDate: accommodation.checkOut.localDate,
        localTime: accommodation.checkOut.localTime,
        timezoneName: accommodation.checkOut.timezoneName,
        instant: accommodation.checkOut.instant,
      },
      roomDescription: accommodation.roomDescription,
      boardType: accommodation.boardType,
    })),
  });

const toCreateInput = (request: AdminCreateM1TripSliceRequest) => ({
  agencyId: asOpaqueId(request.agencyId),
  person: {
    givenName: request.person.givenName,
    familyName: request.person.familyName,
    email: request.person.email,
  },
  customer: { displayName: request.customer.displayName },
  customerPersonRole: request.customerPersonRole,
  trip: {
    title: request.trip.title,
    startDate: request.trip.startDate,
    endDate: request.trip.endDate,
    state: request.trip.state,
  },
  travellerRole: request.travellerRole,
  flight: {
    title: request.flight.title,
    description: request.flight.description,
    carrier: request.flight.carrier,
    flightNumber: request.flight.flightNumber,
    departureAirport: request.flight.departureAirport,
    arrivalAirport: request.flight.arrivalAirport,
    departure: request.flight.departure,
    arrival: request.flight.arrival,
    terminal: request.flight.terminal,
    cabin: request.flight.cabin,
    baggage: request.flight.baggage,
    seat: request.flight.seat,
    customerBookingReference: request.flight.customerBookingReference,
  },
  accommodation: {
    title: request.accommodation.title,
    description: request.accommodation.description,
    propertyName: request.accommodation.propertyName,
    checkIn: request.accommodation.checkIn,
    checkOut: request.accommodation.checkOut,
    roomDescription: request.accommodation.roomDescription,
    boardType: request.accommodation.boardType,
    customerBookingReference: request.accommodation.customerBookingReference,
  },
  reservation: {
    supplierName: request.reservation.supplierName,
    supplierReference: request.reservation.supplierReference,
    customerBookingReference: request.reservation.customerBookingReference,
    state: request.reservation.state,
  },
  supplierCost: {
    amount: createMoney(
      request.supplierCost.amount.minorUnits,
      request.supplierCost.amount.currency,
      request.supplierCost.amount.scale,
    ),
    internalNote: request.supplierCost.internalNote,
  },
});

const toTripWorkspaceCreateInput = (request: AdminTripWorkspaceCreateV1Request) => ({
  customer: { displayName: request.customer.displayName },
  primaryTraveller: {
    givenName: request.primaryTraveller.givenName,
    familyName: request.primaryTraveller.familyName,
  },
  trip: {
    title: request.trip.title,
    startDate: request.trip.startDate,
    endDate: request.trip.endDate,
  },
});

const toWorkspaceFlightDraft = (flight: AdminTripWorkspaceFlightCreateV1Request["flight"]) => ({
  title: flight.title,
  description: flight.description,
  carrier: flight.carrier,
  flightNumber: flight.flightNumber,
  departureAirport: flight.departureAirport,
  arrivalAirport: flight.arrivalAirport,
  departure: {
    localDate: flight.departure.localDate,
    localTime: flight.departure.localTime,
    timezoneName: flight.departure.timezoneName,
    instant: flight.departure.instant,
  },
  arrival: {
    localDate: flight.arrival.localDate,
    localTime: flight.arrival.localTime,
    timezoneName: flight.arrival.timezoneName,
    instant: flight.arrival.instant,
  },
  terminal: flight.terminal,
  cabin: flight.cabin,
  baggage: flight.baggage,
  seat: flight.seat,
  customerBookingReference: flight.customerBookingReference,
});

const toWorkspaceAccommodationDraft = (
  accommodation: AdminTripWorkspaceAccommodationCreateV1Request["accommodation"],
) => ({
  title: accommodation.title,
  description: accommodation.description,
  propertyName: accommodation.propertyName,
  checkIn: {
    localDate: accommodation.checkIn.localDate,
    localTime: accommodation.checkIn.localTime,
    timezoneName: accommodation.checkIn.timezoneName,
    instant: accommodation.checkIn.instant,
  },
  checkOut: {
    localDate: accommodation.checkOut.localDate,
    localTime: accommodation.checkOut.localTime,
    timezoneName: accommodation.checkOut.timezoneName,
    instant: accommodation.checkOut.instant,
  },
  roomDescription: accommodation.roomDescription,
  boardType: accommodation.boardType,
  customerBookingReference: accommodation.customerBookingReference,
});

const toWorkspaceTripDraft = (trip: AdminTripWorkspaceTripUpdateV1Request["trip"]) => ({
  title: trip.title,
  startDate: trip.startDate,
  endDate: trip.endDate,
});

const runHandler = (
  work: () => Promise<void>,
  response: OutgoingHttpResponse,
  next: Next,
): void => {
  response.setHeader("Cache-Control", ADMIN_PRIVATE_NO_STORE);
  void work().catch((error: unknown) => {
    if (error instanceof M1StaffAuthorizationError) {
      response.status(error.code === "UNAUTHENTICATED" ? 401 : 403).end();
      return;
    }
    if (error instanceof M1OptimisticConflictError) {
      send(response, 409, { error: "optimistic_conflict" });
      return;
    }
    if (error instanceof M1TransactionConflictError) {
      send(response, 409, { error: "transaction_conflict" });
      return;
    }
    if (error instanceof StalePublicationCandidateError) {
      send(response, 409, { error: "STALE_PUBLICATION_CANDIDATE" });
      return;
    }
    if (error instanceof IdempotencyConflictError) {
      send(response, 409, { error: "IDEMPOTENCY_KEY_CONFLICT" });
      return;
    }
    if (error instanceof TripPublicationNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof M1TripNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof M1StaffTripAccessNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof M1RuntimeAcceptanceFixtureNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof M1RuntimeAcceptanceFixtureConflictError) {
      const conflictResponse =
        error.recoveryFixtureRunId === null
          ? { error: "runtime_acceptance_fixture_conflict" as const }
          : {
              error: "runtime_acceptance_fixture_conflict" as const,
              recoveryFixtureRunId: error.recoveryFixtureRunId,
            };
      send(
        response,
        409,
        AdminRuntimeAcceptanceFixtureConflictV1ResponseSchema.parse(conflictResponse),
      );
      return;
    }
    if (error instanceof M1StaffPublicationInputError) {
      badRequest(response);
      return;
    }
    if (error instanceof M1InputValidationError) {
      badRequest(response);
      return;
    }
    next(error);
  });
};

export const registerAdminM1Routes = (
  application: AdminM1ExpressApplication,
  options: AdminM1RouteOptions,
): void => {
  application.post("/api/admin/trips/workspace", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminTripWorkspaceCreateV1RequestSchema.safeParse(request.body);
        if (!parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const trip = await options.m1Operations.createTripWorkspace(
          headersFor(request).get("cookie"),
          toTripWorkspaceCreateInput(parsed.data),
        );
        send(
          response,
          201,
          AdminTripWorkspaceV1ResponseSchema.parse({
            trip: mapTripWorkspaceTrip(trip),
            flights: [],
            accommodations: [],
          }),
        );
      },
      response,
      next,
    );
  });

  application.post("/api/admin/trips", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminCreateM1TripSliceRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const headers = headersFor(request);
        const fixtureRunIdHeader = headers.get(ADMIN_RUNTIME_ACCEPTANCE_FIXTURE_RUN_HEADER);
        if (fixtureRunIdHeader !== null) {
          const fixtureOperations = options.runtimeAcceptanceFixtureOperations;
          const fixtureRunId = idFrom(fixtureRunIdHeader);
          if (fixtureOperations === undefined) {
            response.status(403).end();
            return;
          }
          if (fixtureRunId === null) {
            badRequest(response);
            return;
          }
          const slice = await fixtureOperations.createFixtureTrip(
            headers.get("cookie"),
            toCreateInput(parsed.data),
            fixtureRunId,
          );
          send(response, 201, mapSlice(slice));
          return;
        }
        const slice = await options.m1Operations.createTripSlice(
          headers.get("cookie"),
          toCreateInput(parsed.data),
        );
        send(response, 201, mapSlice(slice));
      },
      response,
      next,
    );
  });

  if (options.m1WorkspaceOperations !== undefined) {
    const workspaceOperations = options.m1WorkspaceOperations;
    application.get("/api/admin/trips", (request, response, next) => {
      runHandler(
        async () => {
          const parsed = AdminTripWorkspaceListV1QuerySchema.safeParse(request.query ?? {});
          if (!parsed.success) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, false);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const page = await workspaceOperations.listTrips(headersFor(request).get("cookie"), {
            limit: parsed.data.limit,
            cursor: parsed.data.cursor === null ? null : asOpaqueId(parsed.data.cursor),
          });
          send(
            response,
            200,
            AdminTripWorkspaceListV1ResponseSchema.parse({
              items: page.items.map(mapTripWorkspaceTrip),
              nextCursor: page.nextCursor,
            }),
          );
        },
        response,
        next,
      );
    });

    application.get("/api/admin/trips/:tripId/workspace", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          if (tripId === null) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, false);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const workspace = await workspaceOperations.readTripWorkspace(
            headersFor(request).get("cookie"),
            tripId,
          );
          if (workspace === null) {
            response.status(404).end();
            return;
          }
          send(response, 200, mapTripWorkspace(workspace));
        },
        response,
        next,
      );
    });
  }

  if (options.m1WorkspaceWriteOperations !== undefined) {
    const writeOperations = options.m1WorkspaceWriteOperations;
    application.post("/api/admin/trips/:tripId/workspace/flights", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          const parsed = AdminTripWorkspaceFlightCreateV1RequestSchema.safeParse(request.body);
          if (tripId === null || !parsed.success) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const workspace = await writeOperations.createFlight(
            headersFor(request).get("cookie"),
            tripId,
            {
              expectedWorkspaceRevision: BigInt(parsed.data.expectedWorkspaceRevision),
              flight: toWorkspaceFlightDraft(parsed.data.flight),
            },
          );
          send(response, 201, mapTripWorkspace(workspace));
        },
        response,
        next,
      );
    });

    application.patch(
      "/api/admin/trips/:tripId/workspace/flights/:itemId",
      (request, response, next) => {
        runHandler(
          async () => {
            const tripId = idFrom(request.params?.tripId);
            const itemId = idFrom(request.params?.itemId);
            const parsed = AdminTripWorkspaceFlightUpdateV1RequestSchema.safeParse(request.body);
            if (tripId === null || itemId === null || !parsed.success) {
              badRequest(response);
              return;
            }
            const rejection = surfaceRejectionStatus(request, options.policy, true);
            if (rejection !== null) {
              response.status(rejection).end();
              return;
            }
            const workspace = await writeOperations.updateFlight(
              headersFor(request).get("cookie"),
              tripId,
              itemId,
              {
                expectedWorkspaceRevision: BigInt(parsed.data.expectedWorkspaceRevision),
                expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
                flight: toWorkspaceFlightDraft(parsed.data.flight),
              },
            );
            send(response, 200, mapTripWorkspace(workspace));
          },
          response,
          next,
        );
      },
    );

    application.post(
      "/api/admin/trips/:tripId/workspace/accommodations",
      (request, response, next) => {
        runHandler(
          async () => {
            const tripId = idFrom(request.params?.tripId);
            const parsed = AdminTripWorkspaceAccommodationCreateV1RequestSchema.safeParse(
              request.body,
            );
            if (tripId === null || !parsed.success) {
              badRequest(response);
              return;
            }
            const rejection = surfaceRejectionStatus(request, options.policy, true);
            if (rejection !== null) {
              response.status(rejection).end();
              return;
            }
            const workspace = await writeOperations.createAccommodation(
              headersFor(request).get("cookie"),
              tripId,
              {
                expectedWorkspaceRevision: BigInt(parsed.data.expectedWorkspaceRevision),
                accommodation: toWorkspaceAccommodationDraft(parsed.data.accommodation),
              },
            );
            send(response, 201, mapTripWorkspace(workspace));
          },
          response,
          next,
        );
      },
    );

    application.patch(
      "/api/admin/trips/:tripId/workspace/accommodations/:itemId",
      (request, response, next) => {
        runHandler(
          async () => {
            const tripId = idFrom(request.params?.tripId);
            const itemId = idFrom(request.params?.itemId);
            const parsed = AdminTripWorkspaceAccommodationUpdateV1RequestSchema.safeParse(
              request.body,
            );
            if (tripId === null || itemId === null || !parsed.success) {
              badRequest(response);
              return;
            }
            const rejection = surfaceRejectionStatus(request, options.policy, true);
            if (rejection !== null) {
              response.status(rejection).end();
              return;
            }
            const workspace = await writeOperations.updateAccommodation(
              headersFor(request).get("cookie"),
              tripId,
              itemId,
              {
                expectedWorkspaceRevision: BigInt(parsed.data.expectedWorkspaceRevision),
                expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
                accommodation: toWorkspaceAccommodationDraft(parsed.data.accommodation),
              },
            );
            send(response, 200, mapTripWorkspace(workspace));
          },
          response,
          next,
        );
      },
    );

    application.patch("/api/admin/trips/:tripId/workspace", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          const parsed = AdminTripWorkspaceTripUpdateV1RequestSchema.safeParse(request.body);
          if (tripId === null || !parsed.success) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const workspace = await writeOperations.updateTrip(
            headersFor(request).get("cookie"),
            tripId,
            {
              expectedWorkspaceRevision: BigInt(parsed.data.expectedWorkspaceRevision),
              expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
              trip: toWorkspaceTripDraft(parsed.data.trip),
            },
          );
          send(response, 200, mapTripWorkspace(workspace));
        },
        response,
        next,
      );
    });
  }

  application.get("/api/admin/trips/:tripId", (request, response, next) => {
    runHandler(
      async () => {
        const tripId = idFrom(request.params?.tripId);
        if (tripId === null) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, false);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const slice = await options.m1Operations.readTripSlice(
          headersFor(request).get("cookie"),
          tripId,
        );
        if (slice === null) {
          response.status(404).end();
          return;
        }
        send(response, 200, mapSlice(slice));
      },
      response,
      next,
    );
  });

  if (options.runtimeAcceptanceFixtureOperations !== undefined) {
    const fixtureOperations = options.runtimeAcceptanceFixtureOperations;
    application.post(
      "/api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup",
      (request, response, next) => {
        runHandler(
          async () => {
            const fixtureRunId = idFrom(request.params?.fixtureRunId);
            const parsed = AdminRuntimeAcceptanceFixtureCleanupV1RequestSchema.safeParse(
              request.body,
            );
            if (fixtureRunId === null || !parsed.success) {
              badRequest(response);
              return;
            }
            const rejection = surfaceRejectionStatus(request, options.policy, true);
            if (rejection !== null) {
              response.status(rejection).end();
              return;
            }
            const receipt = await fixtureOperations.cleanupFixture(
              headersFor(request).get("cookie"),
              fixtureRunId,
              parsed.data,
            );
            send(
              response,
              200,
              AdminRuntimeAcceptanceCleanupV1ResponseSchema.parse({
                fixtureRunId: receipt.fixtureRunId,
                state: receipt.state,
                counts: {
                  grantsRevoked: receipt.counts.grantsRevoked,
                  publicationsWithdrawn: receipt.counts.publicationsWithdrawn,
                  tripsCancelled: receipt.counts.tripsCancelled,
                  principalsRetired: receipt.counts.principalsRetired,
                },
                retainedHistoryCounts: {
                  publicationSnapshots: receipt.retainedHistoryCounts.publicationSnapshots,
                  auditRecords: receipt.retainedHistoryCounts.auditRecords,
                },
                errorCode: receipt.errorCode,
              }),
            );
          },
          response,
          next,
        );
      },
    );
  }

  application.patch("/api/admin/itinerary/accommodations/:itemId", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminAccommodationUpdateRequestSchema.safeParse(request.body);
        const itemId = idFrom(request.params?.itemId);
        if (!parsed.success || itemId === null || parsed.data.itemId !== itemId) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const slice = await options.m1Operations.updateAccommodation(
          headersFor(request).get("cookie"),
          {
            agencyId: asOpaqueId(parsed.data.agencyId),
            tripId: asOpaqueId(parsed.data.tripId),
            itemId,
            expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
            title: parsed.data.title,
            description: parsed.data.description,
          },
        );
        send(response, 200, mapSlice(slice));
      },
      response,
      next,
    );
  });

  application.patch(
    "/api/admin/reservations/:reservationId/internal-note",
    (request, response, next) => {
      runHandler(
        async () => {
          const parsed = AdminSupplierCostNoteUpdateRequestSchema.safeParse(request.body);
          const reservationId = idFrom(request.params?.reservationId);
          if (
            !parsed.success ||
            reservationId === null ||
            parsed.data.reservationId !== reservationId
          ) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const slice = await options.m1Operations.updateInternalSupplierNote(
            headersFor(request).get("cookie"),
            {
              agencyId: asOpaqueId(parsed.data.agencyId),
              tripId: asOpaqueId(parsed.data.tripId),
              reservationId,
              expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
              internalNote: parsed.data.internalNote,
            },
          );
          send(response, 200, mapSlice(slice));
        },
        response,
        next,
      );
    },
  );

  if (options.m1TripAccessOperations !== undefined) {
    const tripAccessOperations = options.m1TripAccessOperations;
    application.post("/api/admin/trips/:tripId/portal-access-grants", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          const parsed = AdminTripAccessGrantIssueV1RequestSchema.safeParse(request.body);
          if (tripId === null || !parsed.success || parsed.data.tripId !== tripId) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const grant = await tripAccessOperations.issueTripAccessGrant(
            headersFor(request).get("cookie"),
            parsed.data,
          );
          send(response, 201, AdminTripAccessGrantV1ResponseSchema.parse(grant));
        },
        response,
        next,
      );
    });

    application.post(
      "/api/admin/portal-access-grants/:grantId/revocations",
      (request, response, next) => {
        runHandler(
          async () => {
            const grantId = idFrom(request.params?.grantId);
            const parsed = AdminTripAccessGrantRevokeV1RequestSchema.safeParse(request.body);
            if (grantId === null || !parsed.success || parsed.data.grantId !== grantId) {
              badRequest(response);
              return;
            }
            const rejection = surfaceRejectionStatus(request, options.policy, true);
            if (rejection !== null) {
              response.status(rejection).end();
              return;
            }
            const grant = await tripAccessOperations.revokeTripAccessGrant(
              headersFor(request).get("cookie"),
              parsed.data,
            );
            send(response, 200, AdminTripAccessGrantV1ResponseSchema.parse(grant));
          },
          response,
          next,
        );
      },
    );
  }

  if (options.m1PublicationOperations !== undefined) {
    const publicationOperations = options.m1PublicationOperations;
    application.get("/api/admin/trips/:tripId/publication-preview", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          if (tripId === null) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, false);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const candidate = await publicationOperations.previewTrip(
            headersFor(request).get("cookie"),
            tripId,
          );
          send(
            response,
            200,
            AdminTripPublicationPreviewV1Schema.parse({
              workspaceRevision: candidate.workspaceRevision.toString(),
              projectionHash: candidate.projectionHash,
              schemaVersion: candidate.schemaVersion,
              projection: candidate.projection,
            }),
          );
        },
        response,
        next,
      );
    });

    application.post("/api/admin/trips/:tripId/publications", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          const parsed = AdminPublishTripV1RequestSchema.safeParse(request.body);
          if (tripId === null || !parsed.success) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const result = await publicationOperations.publishTrip(
            headersFor(request).get("cookie"),
            tripId,
            parsed.data,
          );
          send(response, 200, AdminTripPublicationV1ResponseSchema.parse(result));
        },
        response,
        next,
      );
    });

    application.get("/api/admin/trips/:tripId/publications", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          const query = request.query ?? {};
          const cursor = query.before;
          if (
            tripId === null ||
            Object.keys(query).some((key) => key !== "before") ||
            (Array.isArray(cursor) && cursor.length !== 1)
          ) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, false);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const page = await publicationOperations.listPublicationHistory(
            headersFor(request).get("cookie"),
            tripId,
            Array.isArray(cursor) ? cursor[0] : cursor,
          );
          send(response, 200, AdminTripPublicationHistoryV1ResponseSchema.parse(page));
        },
        response,
        next,
      );
    });
  }
};
