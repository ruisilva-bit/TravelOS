import {
  asOpaqueId,
  M1InputValidationError,
  M1OptimisticConflictError,
  M1TransactionConflictError,
  M1StaffAuthorizationError,
  M1StaffPublicationInputError,
  StalePublicationCandidateError,
  IdempotencyConflictError,
  TripPublicationNotFoundError,
  createMoney,
  moneyToJson,
  type M1StaffTripOperations,
  type M1StaffTripPublicationOperations,
  type M1TripSlice,
} from "@travelos/backend-core";
import {
  AdminAccommodationUpdateRequestSchema,
  AdminCreateM1TripSliceRequestSchema,
  AdminM1TripSliceResponseSchema,
  AdminSupplierCostNoteUpdateRequestSchema,
  AdminPublishTripV1RequestSchema,
  AdminTripPublicationHistoryV1ResponseSchema,
  AdminTripPublicationPreviewV1Schema,
  AdminTripPublicationV1ResponseSchema,
  type AdminCreateM1TripSliceRequest,
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
  readonly m1PublicationOperations?: M1StaffTripPublicationOperations;
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
        const slice = await options.m1Operations.createTripSlice(
          headersFor(request).get("cookie"),
          toCreateInput(parsed.data),
        );
        send(response, 201, mapSlice(slice));
      },
      response,
      next,
    );
  });

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
