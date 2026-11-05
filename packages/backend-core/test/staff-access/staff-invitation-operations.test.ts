import { describe, expect, it, vi } from "vitest";

import * as backendCore from "../../src/index.js";
import type {
  OpaqueId,
  StaffAuthorizationOperationProof,
  StaffAuthorizationSnapshot,
  StaffPermissionId,
  TransactionContext,
} from "../../src/index.js";

const agencyId = "abcdef12-3456-7abc-8def-000000000001" as OpaqueId;
const invitationId = "abcdef12-3456-7abc-8def-000000000002" as OpaqueId;
const cursorId = "abcdef12-3456-7abc-8def-000000000003" as OpaqueId;
const nowEpochMs = Date.parse("2026-11-02T12:00:00.000Z");
const validToken = "A".repeat(43);
const newToken = "B".repeat(43);
const previousToken = "C".repeat(43);
const validDigest = "a".repeat(64);
const newDigest = "b".repeat(64);
const principalId = "staff-principal-owner";
const session = {
  sessionId: "staff-session-owner",
  staffPrincipalId: principalId,
  agencyId,
  authorizationEpoch: 2n,
  expiresAtEpochMs: nowEpochMs + 60_000,
  recentMfaVerifiedAtEpochMs: nowEpochMs - 1_000,
};

interface InvitationRecord {
  readonly invitationId: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly targetEmail: string;
  readonly roleTemplateKey: "trip-operations-v1";
  readonly status: "PENDING" | "CONSUMED" | "REVOKED" | "EXPIRED";
  readonly tokenDigest: string;
  readonly createdAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly consumedAtEpochMs: number | null;
  readonly revokedAtEpochMs: number | null;
}

interface InvitationMetadata {
  readonly invitationId: OpaqueId;
  readonly targetEmail: string;
  readonly status: InvitationRecord["status"];
  readonly createdAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly consumedAtEpochMs: number | null;
  readonly revokedAtEpochMs: number | null;
}

interface InvitationPage {
  readonly items: readonly InvitationRecord[];
  readonly nextCursor: OpaqueId | null;
}

interface StaffIdentityEnrollment {
  enroll(
    context: TransactionContext,
    input: { readonly email: string; readonly name: string; readonly password: string },
  ): Promise<{ readonly staffPrincipalId: string }>;
}

interface InvitationRepository {
  listAndExpireDue(input: {
    readonly agencyId: OpaqueId;
    readonly actorStaffPrincipalId: string;
    readonly nowEpochMs: number;
    readonly limit: number;
    readonly cursor: OpaqueId | null;
    readonly authorization: StaffAuthorizationOperationProof;
  }): Promise<InvitationPage>;
  issue(input: {
    readonly agencyId: OpaqueId;
    readonly actorStaffPrincipalId: string;
    readonly targetEmail: string;
    readonly tokenDigest: string;
    readonly roleTemplateKey: "trip-operations-v1";
    readonly expiresAtEpochMs: number;
    readonly nowEpochMs: number;
    readonly authorization: StaffAuthorizationOperationProof;
  }): Promise<InvitationRecord>;
  reissue(input: {
    readonly agencyId: OpaqueId;
    readonly invitationId: OpaqueId;
    readonly actorStaffPrincipalId: string;
    readonly tokenDigest: string;
    readonly expiresAtEpochMs: number;
    readonly nowEpochMs: number;
    readonly authorization: StaffAuthorizationOperationProof;
  }): Promise<InvitationRecord>;
  revoke(input: {
    readonly agencyId: OpaqueId;
    readonly invitationId: OpaqueId;
    readonly actorStaffPrincipalId: string;
    readonly nowEpochMs: number;
    readonly authorization: StaffAuthorizationOperationProof;
  }): Promise<InvitationRecord>;
  accept(
    input: {
      readonly tokenDigest: string;
      readonly name: string;
      readonly password: string;
      readonly nowEpochMs: number;
    },
    enrollment: StaffIdentityEnrollment,
  ): Promise<void>;
}

interface InvitationOperations {
  list(
    cookieHeader: unknown,
    query: { readonly limit: number; readonly cursor: OpaqueId | null },
  ): Promise<{
    readonly items: readonly InvitationMetadata[];
    readonly nextCursor: OpaqueId | null;
  }>;
  issue(
    cookieHeader: unknown,
    input: { readonly targetEmail: string },
  ): Promise<{ readonly invitation: InvitationMetadata; readonly token: string }>;
  reissue(
    cookieHeader: unknown,
    invitationId: OpaqueId,
  ): Promise<{ readonly invitation: InvitationMetadata; readonly token: string }>;
  revoke(cookieHeader: unknown, invitationId: OpaqueId): Promise<InvitationMetadata>;
  accept(input: {
    readonly token: string;
    readonly name: string;
    readonly password: string;
  }): Promise<{ readonly accepted: true }>;
}

interface Dependencies {
  readonly repository: InvitationRepository;
  readonly authorizationRepository: {
    getStaffAuthorizationSnapshot(
      staffPrincipalId: string,
      agencyId: OpaqueId,
    ): Promise<StaffAuthorizationSnapshot | null>;
  };
  readonly sessionResolver: { resolveStaffSession(cookieHeader: string): Promise<unknown> };
  readonly tokenFactory: {
    create(): { readonly token: string; readonly digest: string };
    digest(token: string): string;
  };
  readonly identityEnrollment: StaffIdentityEnrollment;
  readonly nowEpochMs: () => number;
}

type CreateOperations = (dependencies: Dependencies) => InvitationOperations;
const exportedFactory = (
  backendCore as unknown as { readonly createStaffInvitationOperations?: unknown }
).createStaffInvitationOperations;
const createOperations: CreateOperations | null =
  typeof exportedFactory === "function" ? (exportedFactory as CreateOperations) : null;

const invitationRecord = (overrides: Partial<InvitationRecord> = {}): InvitationRecord => ({
  invitationId,
  agencyId,
  targetEmail: "locked.qa@example.test",
  roleTemplateKey: "trip-operations-v1",
  status: "PENDING",
  tokenDigest: validDigest,
  createdAtEpochMs: nowEpochMs - 1_000,
  expiresAtEpochMs: nowEpochMs + 3_600_000,
  consumedAtEpochMs: null,
  revokedAtEpochMs: null,
  ...overrides,
});

const makeDependencies = ({
  permissions = ["staff.invite" as const],
  sessionValue = session,
  listRecords = [invitationRecord()],
}: {
  readonly permissions?: readonly StaffPermissionId[];
  readonly sessionValue?: unknown;
  readonly listRecords?: readonly InvitationRecord[];
} = {}) => {
  const record = invitationRecord();
  const repository: InvitationRepository = {
    listAndExpireDue: vi.fn(async () => ({ items: listRecords, nextCursor: cursorId })),
    issue: vi.fn(async (input) =>
      invitationRecord({ targetEmail: input.targetEmail, tokenDigest: input.tokenDigest }),
    ),
    reissue: vi.fn(async (input) =>
      invitationRecord({
        tokenDigest: input.tokenDigest,
        expiresAtEpochMs: input.expiresAtEpochMs,
      }),
    ),
    revoke: vi.fn(async (input) =>
      invitationRecord({ status: "REVOKED", revokedAtEpochMs: input.nowEpochMs }),
    ),
    accept: vi.fn(async () => undefined),
  };
  const authorizationRepository = {
    getStaffAuthorizationSnapshot: vi.fn(
      async (staffPrincipalId: string, snapshotAgencyId: OpaqueId) => ({
        staffPrincipalId,
        agencyId: snapshotAgencyId,
        membershipState: "ACTIVE" as const,
        authorizationEpoch: session.authorizationEpoch,
        assignments: permissions.map((permissionId) => ({
          agencyId: snapshotAgencyId,
          permissionId,
          scopeKind: "AGENCY" as const,
          organizationUnitId: null,
          accessLevel: "ALL" as const,
          active: true,
        })),
      }),
    ),
  };
  const sessionResolver = { resolveStaffSession: vi.fn(async () => sessionValue) };
  const tokenFactory = {
    create: vi.fn(() => ({ token: newToken, digest: newDigest })),
    digest: vi.fn((value: string) => (value === validToken ? validDigest : newDigest)),
  };
  const identityEnrollment: StaffIdentityEnrollment = {
    enroll: vi.fn(async () => ({ staffPrincipalId: "staff-principal-new" })),
  };

  return {
    record,
    repository,
    authorizationRepository,
    sessionResolver,
    tokenFactory,
    identityEnrollment,
    dependencies: {
      repository,
      authorizationRepository,
      sessionResolver,
      tokenFactory,
      identityEnrollment,
      nowEpochMs: () => nowEpochMs,
    },
  };
};

describe("Staff invitation application operations", () => {
  it("issue_requires_staff_invite_and_recent_mfa", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    for (const values of [
      { permissions: [] as readonly StaffPermissionId[], sessionValue: session },
      {
        permissions: ["staff.invite"] as readonly StaffPermissionId[],
        sessionValue: { ...session, recentMfaVerifiedAtEpochMs: nowEpochMs - 300_001 },
      },
    ]) {
      const context = makeDependencies(values);
      const operations = createOperations(context.dependencies);

      await expect(
        operations.issue("staff-session-cookie", { targetEmail: "qa@example.test" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(context.repository.issue).not.toHaveBeenCalled();
    }
  });

  it("issue_persists_only_the_digest_and_uses_the_fixed_one_hour_expiry", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);
    const result = await operations.issue("staff-session-cookie", {
      targetEmail: "qa@example.test",
    });

    expect(result.token).toBe(newToken);
    expect(result.invitation.targetEmail).toBe("qa@example.test");
    const input = vi.mocked(context.repository.issue).mock.calls[0]?.[0];
    expect(input).toMatchObject({
      agencyId,
      actorStaffPrincipalId: principalId,
      targetEmail: "qa@example.test",
      tokenDigest: newDigest,
      roleTemplateKey: "trip-operations-v1",
      expiresAtEpochMs: nowEpochMs + 3_600_000,
      nowEpochMs,
    });
    expect(Object.keys(input ?? {}).toSorted()).not.toContain("token");
    expect(
      JSON.stringify(input, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain(newToken);
    expect(context.repository.issue).toHaveBeenCalledTimes(1);

    const callerControlledIssue = {
      targetEmail: "qa@example.test",
      agencyId,
      actorStaffPrincipalId: "attacker-controlled-actor",
      roleTemplateKey: "agency-owner-v1",
      permissionIds: ["staff.invite"],
      expiresAtEpochMs: nowEpochMs + 86_400_000,
    };
    await expect(
      operations.issue("staff-session-cookie", callerControlledIssue),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(context.repository.issue).toHaveBeenCalledTimes(1);
  });

  it("list_derives_agency_and_actor_from_session", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const unsafeRecord = {
      ...invitationRecord(),
      token: "one-time-bearer-must-not-appear-in-list",
      unexpectedDigest: validDigest,
    } as unknown as InvitationRecord;
    const context = makeDependencies({ listRecords: [unsafeRecord] });
    const operations = createOperations(context.dependencies);
    const page = await operations.list("staff-session-cookie", { limit: 17, cursor: cursorId });

    expect(page).toEqual({
      items: [
        {
          invitationId,
          targetEmail: "locked.qa@example.test",
          status: "PENDING",
          createdAtEpochMs: nowEpochMs - 1_000,
          expiresAtEpochMs: nowEpochMs + 3_600_000,
          consumedAtEpochMs: null,
          revokedAtEpochMs: null,
        },
      ],
      nextCursor: cursorId,
    });
    expect(JSON.stringify(page)).not.toContain("one-time-bearer-must-not-appear-in-list");
    expect(JSON.stringify(page)).not.toContain(validDigest);
    const input = vi.mocked(context.repository.listAndExpireDue).mock.calls[0]?.[0];
    expect(input).toMatchObject({
      agencyId,
      actorStaffPrincipalId: principalId,
      nowEpochMs,
      limit: 17,
      cursor: cursorId,
    });
    expect(input?.authorization.requiredPermissionIds).toEqual(["staff.invite"]);
    expect(input?.authorization.session.agencyId).toBe(agencyId);
  });

  it("rejects_repository_rows_that_do_not_contain_a_sha256_digest", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const malformedRecord = invitationRecord({ tokenDigest: "raw-bearer-must-not-be-projected" });
    const context = makeDependencies({ listRecords: [malformedRecord] });
    const operations = createOperations(context.dependencies);

    await expect(
      operations.list("staff-session-cookie", { limit: 25, cursor: null }),
    ).rejects.toMatchObject({ code: "STAFF_INVITATION_INVARIANT_VIOLATION" });
  });

  it("reissue_rotates_token_and_never_returns_old_token", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);
    const result = await operations.reissue("staff-session-cookie", invitationId);

    expect(result.token).toBe(newToken);
    expect(result.token).not.toBe(previousToken);
    const input = vi.mocked(context.repository.reissue).mock.calls[0]?.[0];
    expect(input).toMatchObject({
      agencyId,
      invitationId,
      actorStaffPrincipalId: principalId,
      tokenDigest: newDigest,
      expiresAtEpochMs: nowEpochMs + 3_600_000,
      nowEpochMs,
    });
    expect(Object.keys(input ?? {}).toSorted()).not.toContain("token");
    expect(JSON.stringify(result)).not.toContain(previousToken);
    expect(context.tokenFactory.create).toHaveBeenCalledTimes(1);
  });

  it("revoke_requires_recent_mfa", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies({
      sessionValue: { ...session, recentMfaVerifiedAtEpochMs: nowEpochMs - 300_001 },
    });
    const operations = createOperations(context.dependencies);

    await expect(operations.revoke("staff-session-cookie", invitationId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(context.repository.revoke).not.toHaveBeenCalled();
  });

  it("accept_uses_locked_invitation_email_and_fixed_template", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies({ sessionValue: null });
    const lockedInvitation = invitationRecord({
      targetEmail: "owner-approved@example.test",
      roleTemplateKey: "trip-operations-v1",
    });
    const transactionContext = Object.freeze({}) as TransactionContext;
    vi.mocked(context.repository.accept).mockImplementation(async (command, enrollment) => {
      await enrollment.enroll(transactionContext, {
        email: lockedInvitation.targetEmail,
        name: command.name,
        password: command.password,
      });
    });
    const operations = createOperations(context.dependencies);
    const result = await operations.accept({
      token: validToken,
      name: "QA Operator",
      password: "synthetic-test-password",
    });

    expect(result).toEqual({ accepted: true });
    expect(lockedInvitation.roleTemplateKey).toBe("trip-operations-v1");
    expect(context.tokenFactory.digest).toHaveBeenCalledWith(validToken);
    const command = vi.mocked(context.repository.accept).mock.calls[0]?.[0];
    expect(Object.keys(command ?? {}).toSorted()).toEqual([
      "name",
      "nowEpochMs",
      "password",
      "tokenDigest",
    ]);
    expect(command?.tokenDigest).toBe(validDigest);
    expect(JSON.stringify(command)).not.toContain(validToken);
    expect(context.identityEnrollment.enroll).toHaveBeenCalledWith(transactionContext, {
      email: lockedInvitation.targetEmail,
      name: "QA Operator",
      password: "synthetic-test-password",
    });
    expect(context.authorizationRepository.getStaffAuthorizationSnapshot).not.toHaveBeenCalled();
  });

  it("invalid_token_fails_without_enrollment", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies({ sessionValue: null });
    const operations = createOperations(context.dependencies);

    await expect(
      operations.accept({
        token: "malformed",
        name: "QA Operator",
        password: "synthetic-test-password",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED" });
    expect(context.repository.accept).not.toHaveBeenCalled();
    expect(context.identityEnrollment.enroll).not.toHaveBeenCalled();

    const callerControlledAcceptance = {
      token: validToken,
      name: "QA Operator",
      password: "synthetic-test-password",
      email: "attacker@example.test",
      agencyId,
      roleTemplateKey: "agency-owner-v1",
      permissionIds: ["staff.invite"],
    };
    await expect(operations.accept(callerControlledAcceptance)).rejects.toMatchObject({
      code: "INVALID_OR_EXPIRED",
    });
    expect(context.repository.accept).not.toHaveBeenCalled();

    vi.mocked(context.repository.accept).mockRejectedValue(
      Object.assign(new Error("Invitation is invalid or expired"), { code: "INVALID_OR_EXPIRED" }),
    );
    await expect(
      operations.accept({
        token: validToken,
        name: "QA Operator",
        password: "synthetic-test-password",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED" });
    expect(context.identityEnrollment.enroll).not.toHaveBeenCalled();
  });
});
