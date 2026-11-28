import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  InputValidationError,
  OptimisticConflictError,
  StaffAuthorizationError,
  createStaffAgencyProfileOperations,
  type StaffAgencyProfileOperations,
} from "../../packages/backend-core/src/index.js";
import {
  createPostgresAgencyProfileRepository,
  createStaffAccessRepository,
  type PostgresPersistence,
} from "../../packages/database/src/index.js";
import {
  createOwnerClient,
  createStaff,
  registrySessionResolver,
  type StaffSessionRegistry,
} from "./helpers/postgres.js";
import {
  agencyId,
  databaseName,
  persistence as tripFixturePersistence,
  queryAsOwner,
  queryErrorCode,
  setupTripFixtures,
  teardownTripFixtures,
} from "./helpers/trip-fixtures.js";

const sessions: StaffSessionRegistry = new Map();
const sessionResolver = registrySessionResolver(sessions);

let operations: StaffAgencyProfileOperations;
let managerCookie: string;
let viewerCookie: string;
let initialLockVersion: bigint;

const draft = {
  displayName: "Agência Integração",
  email: "contacto@agencia.example.test",
  phone: "+351 210 000 000",
  website: "https://agencia.example.test",
};

beforeAll(async () => {
  await setupTripFixtures("travelos_agency");
  const persistence = tripFixturePersistence as PostgresPersistence<Record<string, never>>;
  const owner = await createOwnerClient(databaseName);
  managerCookie = (
    await createStaff(
      owner,
      sessions,
      "agency-manager",
      ["agency.view", "agency.manage_settings"],
      {
        agencyId: agencyId as string,
      },
    )
  ).cookie;
  viewerCookie = (
    await createStaff(owner, sessions, "agency-viewer", ["agency.view"], {
      agencyId: agencyId as string,
    })
  ).cookie;
  await owner.end();
  operations = createStaffAgencyProfileOperations({
    repository: createPostgresAgencyProfileRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
  initialLockVersion = (await operations.getProfile(managerCookie)).lockVersion;
});

afterAll(async () => {
  await teardownTripFixtures();
});

describe.sequential("agency profile (0005)", () => {
  it("reads the seeded default display name for a viewer", async () => {
    const profile = await operations.getProfile(viewerCookie);
    expect(profile.displayName).toBe("A sua agência de viagens");
    expect(profile.email).toBeNull();
    expect(profile.lockVersion).toBe(initialLockVersion);
  });

  it("denies a viewer without agency.manage_settings and leaves the row unchanged", async () => {
    await expect(
      operations.updateProfile(viewerCookie, {
        expectedLockVersion: initialLockVersion,
        profile: draft,
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect((await operations.getProfile(managerCookie)).displayName).toBe(
      "A sua agência de viagens",
    );
  });

  it("applies a compare-and-swap update and bumps the lock version", async () => {
    const updated = await operations.updateProfile(managerCookie, {
      expectedLockVersion: initialLockVersion,
      profile: draft,
    });
    expect(updated).toMatchObject({
      displayName: "Agência Integração",
      email: "contacto@agencia.example.test",
      phone: "+351 210 000 000",
      website: "https://agencia.example.test",
      lockVersion: initialLockVersion + 1n,
    });
  });

  it("rejects a stale expected lock version without writing", async () => {
    await expect(
      operations.updateProfile(managerCookie, {
        expectedLockVersion: initialLockVersion,
        profile: { ...draft, displayName: "Sobrescrita" },
      }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);
    expect((await operations.getProfile(managerCookie)).displayName).toBe("Agência Integração");
  });

  it("rejects an invalid draft before reaching the database", async () => {
    await expect(
      operations.updateProfile(managerCookie, {
        expectedLockVersion: initialLockVersion + 1n,
        profile: { ...draft, website: "http://insecure.example.test" },
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("enforces the display-name and website CHECK constraints in the database", async () => {
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          `UPDATE "organization"."agency" SET "displayName" = '   ' WHERE "id" = '${agencyId}'::uuid`,
        ),
      ),
    ).toBe("23514");
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          `UPDATE "organization"."agency" SET "website" = 'http://x.example.test' WHERE "id" = '${agencyId}'::uuid`,
        ),
      ),
    ).toBe("23514");
  });
});
