import { asOpaqueId, createMoney, type M1TripWorkspace } from "@travelos/backend-core";
import {
  ADMIN_RUNTIME_ACCEPTANCE_FIXTURE_RUN_HEADER,
  AdminCreateM1TripSliceRequestSchema,
  AdminTripWorkspaceCreateV1RequestSchema,
  AdminTripWorkspaceListV1QuerySchema,
  AdminTripWorkspaceListV1ResponseSchema,
  AdminTripWorkspaceV1ResponseSchema,
  AdminTripWorkspaceFlightCreateV1RequestSchema,
  AdminTripWorkspaceFlightUpdateV1RequestSchema,
  AdminTripWorkspaceAccommodationCreateV1RequestSchema,
  AdminTripWorkspaceAccommodationUpdateV1RequestSchema,
  AdminTripWorkspaceTripUpdateV1RequestSchema,
  type AdminCreateM1TripSliceRequest,
  type AdminTripWorkspaceFlightCreateV1Request,
  type AdminTripWorkspaceAccommodationCreateV1Request,
  type AdminTripWorkspaceTripUpdateV1Request,
  type AdminTripWorkspaceCreateV1Request,
} from "@travelos/contracts/admin";

import { mapSlice } from "./m1-trip-slice-mapper.js";
import {
  badRequest,
  idFrom,
  runHandler,
  send,
  surfaceRejectionStatus,
  type AdminM1ExpressApplication,
  type AdminM1RouteOptions,
} from "./m1-route-http.js";
import { headersFor } from "./request-boundary.js";

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

export const registerAdminTripRoutes = (
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
};
