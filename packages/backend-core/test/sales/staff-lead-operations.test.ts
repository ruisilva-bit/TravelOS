import { describe, expect, it, vi } from "vitest";

import {
  InputValidationError,
  LEAD_PERMISSION_REQUIREMENTS,
  LeadNotFoundError,
  LeadNotOpenError,
  OptimisticConflictError,
  StaffAuthorizationError,
  asOpaqueId,
  createStaffLeadOperations,
  type Lead,
  type LeadDraft,
  type LeadRepository,
  type OpaqueId,
  type StaffPermissionId,
} from "../../src/index.js";

const agencyId = asOpaqueId("abcdef12-3456-7abc-8def-000000000001");
const leadId = asOpaqueId("abcdef12-3456-7abc-8def-000000000002");
const customerId = asOpaqueId("abcdef12-3456-7abc-8def-000000000003");
const nowEpochMs = Date.parse("2026-11-25T12:00:00.000Z");
const session = {
  sessionId: "staff-session-1",
  staffPrincipalId: "staff-principal-1",
  agencyId,
  authorizationEpoch: 2n,
  expiresAtEpochMs: nowEpochMs + 60_000,
  recentMfaVerifiedAtEpochMs: null,
};

const draft: LeadDraft = {
  source: "WEBSITE",
  contactGivenName: "Marta",
  contactFamilyName: "Quintela",
  contactEmail: null,
  contactPhone: null,
  internalNote: null,
};
const storedLead: Lead = {
  ...draft,
  id: leadId,
  agencyId,
  state: "OPEN",
  qualifiedCustomerId: null,
  disqualificationReason: null,
  lockVersion: 1n,
  createdAt: "2026-11-25T10:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
  closedAt: null,
};

const makeContext = (
  permissions: readonly StaffPermissionId[],
  repositoryOverrides: Partial<LeadRepository> = {},
  sessionValue: unknown = session,
) => {
  const repository: LeadRepository = {
    listLeads: vi.fn(async () => ({ items: [storedLead], nextCursor: null })),
    getLead: vi.fn(async () => storedLead),
    createLead: vi.fn(async () => storedLead),
    updateLead: vi.fn(async () => storedLead),
    qualifyLead: vi.fn(async () => storedLead),
    disqualifyLead: vi.fn(async () => storedLead),
    ...repositoryOverrides,
  };
  const authorizationRepository = {
    getStaffAuthorizationSnapshot: vi.fn(async () => ({
      staffPrincipalId: session.staffPrincipalId,
      agencyId,
      membershipState: "ACTIVE" as const,
      authorizationEpoch: session.authorizationEpoch,
      assignments: permissions.map((permissionId) => ({
        agencyId,
        permissionId,
        scopeKind: "AGENCY" as const,
        organizationUnitId: null,
        accessLevel: "ALL" as const,
        active: true,
      })),
    })),
  };
  const sessionResolver = { resolveStaffSession: vi.fn(async () => sessionValue) };
  const operations = createStaffLeadOperations({
    repository,
    authorizationRepository,
    sessionResolver,
    nowEpochMs: () => nowEpochMs,
  });
  return { operations, repository, authorizationRepository, sessionResolver };
};

const cookie = "staff-session-cookie";
const create = { lead: draft, idempotencyKey: null };
const update = { expectedLockVersion: 1n, lead: draft };
const qualifyCreate = {
  expectedLockVersion: 1n,
  mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null } as const,
  idempotencyKey: null,
};
const qualifyLink = {
  expectedLockVersion: 1n,
  mode: { kind: "LINK_CUSTOMER", customerId } as const,
  idempotencyKey: null,
};
const disqualify = {
  expectedLockVersion: 1n,
  reason: "NOT_INTERESTED" as const,
  idempotencyKey: null,
};

type UseCase = readonly [
  string,
  (operations: ReturnType<typeof makeContext>["operations"]) => Promise<unknown>,
  readonly StaffPermissionId[],
];

const useCases: readonly UseCase[] = [
  [
    "listLeads",
    (o) => o.listLeads(cookie, { limit: 10, cursor: null, state: null }),
    ["sales.view"],
  ],
  ["getLead", (o) => o.getLead(cookie, leadId), ["sales.view"]],
  ["createLead", (o) => o.createLead(cookie, create), ["sales.edit"]],
  ["updateLead", (o) => o.updateLead(cookie, leadId, update), ["sales.edit"]],
  ["disqualifyLead", (o) => o.disqualifyLead(cookie, leadId, disqualify), ["sales.edit"]],
  [
    "qualifyLead (create customer)",
    (o) => o.qualifyLead(cookie, leadId, qualifyCreate),
    ["sales.edit", "customer.edit"],
  ],
  [
    "qualifyLead (link customer)",
    (o) => o.qualifyLead(cookie, leadId, qualifyLink),
    ["sales.edit", "customer.edit"],
  ],
];

describe("Staff Lead operations authorization", () => {
  it("fixes the permission policy per use case", () => {
    expect(LEAD_PERMISSION_REQUIREMENTS.VIEW).toEqual(["sales.view"]);
    expect(LEAD_PERMISSION_REQUIREMENTS.EDIT).toEqual(["sales.edit"]);
    expect(LEAD_PERMISSION_REQUIREMENTS.QUALIFY).toEqual(["sales.edit", "customer.edit"]);
  });

  it.each(useCases)(
    "%s passes the exact required permissions and the session Agency to the repository",
    async (_name, run, required) => {
      const context = makeContext(required);
      await run(context.operations);
      const repositoryCalls = Object.values(context.repository).flatMap(
        (mock) => (mock as ReturnType<typeof vi.fn>).mock.calls,
      );
      expect(repositoryCalls).toHaveLength(1);
      const call = repositoryCalls[0] as readonly unknown[];
      expect(call[0]).toBe(agencyId);
      const proof = call.at(-1) as { requiredPermissionIds: readonly string[]; session: unknown };
      expect([...proof.requiredPermissionIds].toSorted()).toEqual([...required].toSorted());
      expect(proof.session).toMatchObject({ agencyId, staffPrincipalId: "staff-principal-1" });
    },
  );

  it.each(useCases)(
    "%s is forbidden for every proper subset of its required permissions and never reaches the repository",
    async (_name, run, required) => {
      const subsets: StaffPermissionId[][] = [
        [],
        ...required.map((_, omitted) => required.filter((_, index) => index !== omitted)),
        ["trip.edit", "trip.view", "customer.view", "customer.edit"].filter(
          (permission) => !required.includes(permission as StaffPermissionId),
        ) as StaffPermissionId[],
      ];
      for (const permissions of subsets) {
        const context = makeContext(permissions);
        await expect(run(context.operations)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(run(context.operations)).rejects.toBeInstanceOf(StaffAuthorizationError);
        for (const mock of Object.values(context.repository)) {
          expect(mock).not.toHaveBeenCalled();
        }
      }
    },
  );

  it("qualification needs both sales.edit and customer.edit, never either one", async () => {
    for (const permissions of [
      ["sales.edit"],
      ["customer.edit"],
      ["sales.view", "customer.edit"],
    ] as const) {
      const context = makeContext(permissions);
      await expect(
        context.operations.qualifyLead(cookie, leadId, qualifyCreate),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);
      expect(context.repository.qualifyLead).not.toHaveBeenCalled();
    }
  });

  it("is unauthenticated for a missing cookie or an unresolved session", async () => {
    const missing = makeContext(["sales.view"]);
    await expect(missing.operations.getLead(undefined, leadId)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const unresolved = makeContext(["sales.view"], {}, null);
    await expect(unresolved.operations.getLead(cookie, leadId)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(unresolved.repository.getLead).not.toHaveBeenCalled();
  });

  it("grants nothing by role-like claims in the session value", async () => {
    const forgedSession = { ...session, roles: ["Owner"], permissions: ["sales.edit"] };
    const context = makeContext([], {}, forgedSession);
    await expect(context.operations.createLead(cookie, create)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(context.repository.createLead).not.toHaveBeenCalled();
  });

  it("ignores any caller-supplied Agency: the repository receives only the session Agency", async () => {
    const context = makeContext(["sales.view"]);
    await context.operations.getLead(cookie, leadId);
    expect(context.repository.getLead).toHaveBeenCalledWith(agencyId, leadId, expect.anything());
  });
});

describe("Staff Lead operations behaviour", () => {
  it("returns the repository Lead and normalizes the draft before persistence", async () => {
    const context = makeContext(["sales.edit"]);
    const padded: LeadDraft = { ...draft, contactGivenName: "  Marta  " };
    await expect(
      context.operations.createLead(cookie, { lead: padded, idempotencyKey: "k-1" }),
    ).resolves.toBe(storedLead);
    expect(context.repository.createLead).toHaveBeenCalledWith(
      agencyId,
      draft,
      "k-1",
      expect.anything(),
    );
  });

  it("maps a missing Lead to the typed NOT_FOUND error", async () => {
    const context = makeContext(["sales.view", "sales.edit", "customer.edit"], {
      getLead: vi.fn(async () => null),
      updateLead: vi.fn(async () => null),
      qualifyLead: vi.fn(async () => null),
      disqualifyLead: vi.fn(async () => null),
    });
    const { operations } = context;
    for (const run of [
      () => operations.getLead(cookie, leadId),
      () => operations.updateLead(cookie, leadId, update),
      () => operations.qualifyLead(cookie, leadId, qualifyCreate),
      () => operations.disqualifyLead(cookie, leadId, disqualify),
    ]) {
      await expect(run()).rejects.toBeInstanceOf(LeadNotFoundError);
      await expect(run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("propagates the typed stale-lock conflict and LEAD_NOT_OPEN without wrapping", async () => {
    const stale = makeContext(["sales.edit"], {
      updateLead: vi.fn(async () => {
        throw new OptimisticConflictError();
      }),
    });
    await expect(stale.operations.updateLead(cookie, leadId, update)).rejects.toBeInstanceOf(
      OptimisticConflictError,
    );
    const closed = makeContext(["sales.edit"], {
      disqualifyLead: vi.fn(async () => {
        throw new LeadNotOpenError();
      }),
    });
    await expect(
      closed.operations.disqualifyLead(cookie, leadId, disqualify),
    ).rejects.toMatchObject({
      code: "LEAD_NOT_OPEN",
    });
  });

  it("rejects invalid input as validation errors before authorization or persistence", async () => {
    const context = makeContext(["sales.view", "sales.edit", "customer.edit"]);
    const { operations } = context;
    const invalid: readonly (() => Promise<unknown>)[] = [
      () =>
        operations.createLead(cookie, {
          lead: { ...draft, contactGivenName: " " },
          idempotencyKey: null,
        }),
      () =>
        operations.createLead(cookie, {
          lead: { ...draft, contactEmail: "nope" },
          idempotencyKey: null,
        }),
      () =>
        operations.createLead(cookie, {
          lead: { ...draft, source: "FAX" as never },
          idempotencyKey: null,
        }),
      () => operations.createLead(cookie, { lead: draft, idempotencyKey: "" }),
      () => operations.createLead(cookie, { lead: draft, idempotencyKey: "a\nb" }),
      () => operations.createLead(cookie, { lead: draft, idempotencyKey: "k".repeat(129) }),
      () => operations.updateLead(cookie, leadId, { expectedLockVersion: 0n, lead: draft }),
      () => operations.updateLead(cookie, leadId, { expectedLockVersion: -1n, lead: draft }),
      () => operations.updateLead(cookie, leadId, { expectedLockVersion: 2n ** 63n, lead: draft }),
      () => operations.updateLead(cookie, leadId, { expectedLockVersion: 1 as never, lead: draft }),
      () => operations.updateLead(cookie, "nope" as OpaqueId, update),
      () => operations.disqualifyLead(cookie, leadId, { ...disqualify, reason: "BORED" as never }),
      () =>
        operations.qualifyLead(cookie, leadId, {
          ...qualifyCreate,
          mode: { kind: "CREATE_CUSTOMER", customerDisplayName: "x".repeat(301) },
        }),
      () =>
        operations.qualifyLead(cookie, leadId, {
          ...qualifyCreate,
          mode: { kind: "LINK_CUSTOMER", customerId: "not-a-uuid" as OpaqueId },
        }),
      () =>
        operations.qualifyLead(cookie, leadId, {
          ...qualifyCreate,
          mode: { kind: "MERGE" } as never,
        }),
      () => operations.listLeads(cookie, { limit: 101, cursor: null, state: null }),
      () => operations.listLeads(cookie, { limit: 0, cursor: null, state: null }),
      () => operations.listLeads(cookie, { limit: 5, cursor: null, state: "PENDING" as never }),
    ];
    for (const run of invalid) {
      await expect(run()).rejects.toBeInstanceOf(InputValidationError);
    }
    expect(context.authorizationRepository.getStaffAuthorizationSnapshot).not.toHaveBeenCalled();
    for (const mock of Object.values(context.repository)) expect(mock).not.toHaveBeenCalled();
  });

  it("accepts list limits from 1 to 100 and passes the state filter and cursor", async () => {
    const context = makeContext(["sales.view"]);
    await context.operations.listLeads(cookie, { limit: 100, cursor: leadId, state: "QUALIFIED" });
    expect(context.repository.listLeads).toHaveBeenCalledWith(
      agencyId,
      { limit: 100, cursor: leadId, state: "QUALIFIED" },
      expect.anything(),
    );
  });

  it("passes the qualification mode and idempotency key through unchanged", async () => {
    const context = makeContext(["sales.edit", "customer.edit"]);
    await context.operations.qualifyLead(cookie, leadId, {
      expectedLockVersion: 4n,
      mode: { kind: "CREATE_CUSTOMER", customerDisplayName: "  Quintela Lda " },
      idempotencyKey: "qualify-1",
    });
    expect(context.repository.qualifyLead).toHaveBeenCalledWith(
      agencyId,
      leadId,
      4n,
      { kind: "CREATE_CUSTOMER", customerDisplayName: "Quintela Lda" },
      "qualify-1",
      expect.anything(),
    );
    await context.operations.qualifyLead(cookie, leadId, qualifyLink);
    expect(context.repository.qualifyLead).toHaveBeenLastCalledWith(
      agencyId,
      leadId,
      1n,
      { kind: "LINK_CUSTOMER", customerId },
      null,
      expect.anything(),
    );
  });
});
