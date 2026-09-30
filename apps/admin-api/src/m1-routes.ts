import {
  asOpaqueId,
  M1OptimisticConflictError,
  M1InputValidationError,
  authorizeStaffRequest,
  createM1TripSlice,
  createMoney,
  moneyToJson,
  readM1TripSlice,
  updateM1Accommodation,
  updateM1InternalSupplierNote,
  type M1OperationalSliceRepository,
  type M1TripSlice,
  type StaffAuthorizationSnapshot,
  type StaffPermissionId,
  type StaffSessionAuthorizationProof,
} from "@travelos/backend-core";
import {
  AdminAccommodationUpdateRequestSchema,
  AdminCreateM1TripSliceRequestSchema,
  AdminM1TripSliceResponseSchema,
  AdminSupplierCostNoteUpdateRequestSchema,
  type AdminCreateM1TripSliceRequest,
} from "@travelos/contracts/admin";
import type { AuthRealm, AuthSurfacePolicy } from "@travelos/auth-adapters";
import type { StaffAccessRepository } from "@travelos/database";

interface IncomingHttpRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly params?: Readonly<Record<string, string | undefined>>;
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
  readonly realm: AuthRealm;
  readonly policy: AuthSurfacePolicy;
  readonly staffAccessRepository: Pick<StaffAccessRepository, "getStaffAuthorizationSnapshot">;
  readonly m1Repository: M1OperationalSliceRepository;
}

const M1_COMPOSITE_READ_PERMISSIONS = [
  "customer.view",
  "traveller.view_sensitive",
  "trip.view",
  "reservation.view",
  "finance.view_costs",
] as const satisfies readonly StaffPermissionId[];

const M1_CREATE_PERMISSIONS = [
  ...M1_COMPOSITE_READ_PERMISSIONS,
  "customer.edit",
  "traveller.edit",
  "trip.edit",
  "reservation.edit",
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];

const M1_ACCOMMODATION_EDIT_PERMISSIONS = [
  ...M1_COMPOSITE_READ_PERMISSIONS,
  "trip.edit",
] as const satisfies readonly StaffPermissionId[];

const M1_INTERNAL_NOTE_EDIT_PERMISSIONS = [
  ...M1_COMPOSITE_READ_PERMISSIONS,
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];

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
): 403 | 404 | null => {
  const headers = headersFor(request);
  if (headers.get("host") !== policy.expectedHost) return 404;
  if (headers.has("authorization") || headers.has("x-forwarded-host")) return 403;
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

const sessionProofFor = async (
  request: IncomingHttpRequest,
  options: AdminM1RouteOptions,
): Promise<StaffSessionAuthorizationProof | null> => {
  const target = routeUrlFor(request, options.policy);
  if (target === null) return null;
  const session = await options.realm.getServerSession(
    new Request(target, { headers: headersFor(request) }),
  );
  if (session === null || session.agencyId === null || session.authorizationEpoch === null)
    return null;
  return {
    staffPrincipalId: session.principalId,
    agencyId: session.agencyId,
    authorizationEpoch: session.authorizationEpoch,
    expiresAtEpochMs: session.expiresAtEpochMs,
    recentMfaVerifiedAtEpochMs: session.recentMfaVerifiedAtEpochMs,
  };
};

const authorizeFor = async (
  request: IncomingHttpRequest,
  options: AdminM1RouteOptions,
  agencyId: string,
  permissionIds: readonly StaffPermissionId[],
): Promise<
  { readonly proof: StaffSessionAuthorizationProof } | { readonly status: 401 | 403 | 404 }
> => {
  const rejection = surfaceRejectionStatus(request, options.policy);
  if (rejection !== null) return { status: rejection };
  const proof = await sessionProofFor(request, options);
  if (proof === null) return { status: 401 };
  const targetAgencyId = agencyId === "" ? proof.agencyId : agencyId;
  if (proof.agencyId !== targetAgencyId) return { status: 403 };
  const snapshot: StaffAuthorizationSnapshot | null =
    await options.staffAccessRepository.getStaffAuthorizationSnapshot(proof.staffPrincipalId);
  for (const permissionId of permissionIds) {
    const decision = authorizeStaffRequest({
      session: proof,
      snapshot,
      permissionId,
      target: {
        agencyId: targetAgencyId,
        organizationUnitAncestorIds: [],
        requiredAccessLevel: "ALL",
      },
      nowEpochMs: Date.now(),
      recentMfaMaximumAgeMs: null,
    });
    if (decision.result === "DENY") {
      return { status: decision.reason === "UNAUTHENTICATED" ? 401 : 403 };
    }
  }
  return { proof };
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
  response.setHeader("Cache-Control", "private, no-store");
  void work().catch((error: unknown) => {
    if (error instanceof M1OptimisticConflictError) {
      send(response, 409, { error: "optimistic_conflict" });
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
        const authorized = await authorizeFor(
          request,
          options,
          parsed.data.agencyId,
          M1_CREATE_PERMISSIONS,
        );
        if ("status" in authorized) {
          response.status(authorized.status).end();
          return;
        }
        const slice = await createM1TripSlice(options.m1Repository, toCreateInput(parsed.data));
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
        const authorized = await authorizeFor(request, options, "", M1_COMPOSITE_READ_PERMISSIONS);
        if ("status" in authorized) {
          response.status(authorized.status).end();
          return;
        }
        const slice = await readM1TripSlice(
          options.m1Repository,
          asOpaqueId(authorized.proof.agencyId),
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
        const authorized = await authorizeFor(
          request,
          options,
          parsed.data.agencyId,
          M1_ACCOMMODATION_EDIT_PERMISSIONS,
        );
        if ("status" in authorized) {
          response.status(authorized.status).end();
          return;
        }
        const slice = await updateM1Accommodation(options.m1Repository, {
          agencyId: asOpaqueId(parsed.data.agencyId),
          tripId: asOpaqueId(parsed.data.tripId),
          itemId,
          expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
          title: parsed.data.title,
          description: parsed.data.description,
        });
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
          const authorized = await authorizeFor(
            request,
            options,
            parsed.data.agencyId,
            M1_INTERNAL_NOTE_EDIT_PERMISSIONS,
          );
          if ("status" in authorized) {
            response.status(authorized.status).end();
            return;
          }
          const slice = await updateM1InternalSupplierNote(options.m1Repository, {
            agencyId: asOpaqueId(parsed.data.agencyId),
            tripId: asOpaqueId(parsed.data.tripId),
            reservationId,
            expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
            internalNote: parsed.data.internalNote,
          });
          send(response, 200, mapSlice(slice));
        },
        response,
        next,
      );
    },
  );
};
