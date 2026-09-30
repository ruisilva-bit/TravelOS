import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { STAFF_AUTH_BASE_PATH, type AuthRealm } from "@travelos/auth-adapters";
import {
  createM1StaffTripOperations,
  type M1OperationalSliceRepository,
} from "@travelos/backend-core";

import { createAdminApi } from "../src/app.js";

const agencyId = "00000000-0000-4000-8000-000000000001";
const syntheticEmail = ["rui", "example.test"].join(String.fromCharCode(64));

const validCreateBody = () => ({
  agencyId,
  person: { givenName: "Rui", familyName: "Silva", email: syntheticEmail },
  customer: { displayName: "Silva Travel" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: { title: "API trip", startDate: "2026-09-25", endDate: "2026-09-28", state: "DRAFT" },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Flight",
    description: "Synthetic flight",
    carrier: "Example Air",
    flightNumber: "EA100",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: {
      localDate: "2026-09-25",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T08:00:00Z",
    },
    arrival: {
      localDate: "2026-09-25",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T09:00:00Z",
    },
    terminal: null,
    cabin: "ECONOMY",
    baggage: "1 bag",
    seat: null,
    customerBookingReference: "BOOK-1",
  },
  accommodation: {
    title: "Hotel",
    description: "Synthetic hotel",
    propertyName: "Example Hotel",
    checkIn: {
      localDate: "2026-09-25",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T14:00:00Z",
    },
    checkOut: {
      localDate: "2026-09-28",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-28T10:00:00Z",
    },
    roomDescription: "Double",
    boardType: "BREAKFAST",
    customerBookingReference: "HOTEL-1",
  },
  reservation: {
    supplierName: "Supplier",
    supplierReference: "SUP-1",
    customerBookingReference: "CUST-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: { minorUnits: "12345", currency: "EUR", scale: 2 },
    internalNote: "internal",
  },
});

describe("Admin Stage 5 composed HTTP body parsing", () => {
  it("parses JSON before the raw Stage 5 write routes are reached", async () => {
    const realm = {
      kind: "STAFF",
      basePath: STAFF_AUTH_BASE_PATH,
      getServerSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuthRealm;
    const m1Repository: M1OperationalSliceRepository = {
      createM1TripSlice: vi.fn(),
      getM1TripSlice: vi.fn(),
      updateAccommodation: vi.fn(),
      updateInternalSupplierNote: vi.fn(),
    };
    const m1Operations = createM1StaffTripOperations({
      repository: m1Repository,
      authorizationRepository: {
        getStaffAuthorizationSnapshot: vi.fn().mockResolvedValue(null),
      },
      sessionResolver: { resolveStaffSession: vi.fn().mockResolvedValue(null) },
    });
    const application = await createAdminApi({
      expectedHost: "admin.example.test",
      auth: {
        realm,
        policy: {
          canonicalOrigin: "https://admin.example.test",
          expectedHost: "admin.example.test",
        },
        staffAccessRepository: { getStaffAuthorizationSnapshot: vi.fn().mockResolvedValue(null) },
        m1Operations,
      },
    });
    try {
      const rejectedBeforeParsing = await request(application.getHttpServer())
        .post("/api/admin/trips")
        .set("Host", "attacker.example.test")
        .set("Content-Type", "application/json")
        .send("{");
      expect(rejectedBeforeParsing.status).toBe(404);
      expect(rejectedBeforeParsing.text).toBe("");
      expect(m1Repository.createM1TripSlice).not.toHaveBeenCalled();

      const response = await request(application.getHttpServer())
        .post("/api/admin/trips")
        .set("Host", "admin.example.test")
        .set("X-Forwarded-Host", "admin.example.test")
        .send(validCreateBody());
      expect(response.status).toBe(401);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(m1Repository.createM1TripSlice).not.toHaveBeenCalled();

      const invalidRoleResponse = await request(application.getHttpServer())
        .post("/api/admin/trips")
        .set("Host", "admin.example.test")
        .send({ ...validCreateBody(), travellerRole: "TRAVELLER" });
      expect(invalidRoleResponse.status).toBe(400);
      expect(invalidRoleResponse.headers["cache-control"]).toBe("private, no-store");
      expect(m1Repository.createM1TripSlice).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });
});
