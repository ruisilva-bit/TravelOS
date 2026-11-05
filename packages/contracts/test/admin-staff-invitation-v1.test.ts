import { describe, expect, it } from "vitest";

import * as adminContracts from "../src/admin/index.js";
import { AdminStaffSessionContextSchema } from "../src/admin/auth/session-context.js";

interface ContractSchema {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { readonly success: boolean };
}

const schema = (name: string): ContractSchema => {
  const candidate = (adminContracts as unknown as Record<string, unknown>)[name];
  expect(candidate, `Missing public Admin contract export: ${name}`).toBeDefined();
  return candidate as ContractSchema;
};

const token = "A".repeat(43);
const invitationId = "00000000-0000-7000-8000-000000000001";
const metadata = {
  invitationId,
  targetEmail: "qa@example.test",
  status: "PENDING",
  createdAt: "2026-11-02T10:00:00.000Z",
  expiresAt: "2026-11-02T11:00:00.000Z",
  consumedAt: null,
  revokedAt: null,
};
const sessionContext = {
  principalId: "staff-principal-qa",
  agencyId: "00000000-0000-7000-8000-000000000002",
  authorizationEpoch: "1",
  recentMfaVerifiedAtEpochMs: null,
};

describe("Admin Staff invitation v1 contracts", () => {
  it("exports strict issue, list, accept, safe metadata, page and one-time response schemas", () => {
    for (const name of [
      "AdminStaffInvitationIssueV1RequestSchema",
      "AdminStaffInvitationListV1QuerySchema",
      "AdminStaffInvitationAcceptV1RequestSchema",
      "AdminStaffInvitationMetadataV1Schema",
      "AdminStaffInvitationListV1ResponseSchema",
      "AdminStaffInvitationOneTimeV1ResponseSchema",
    ]) {
      expect(schema(name)).toBeDefined();
    }
  });

  it("accepts only targetEmail for issue and only token, name and password for acceptance", () => {
    const issue = schema("AdminStaffInvitationIssueV1RequestSchema");
    const accept = schema("AdminStaffInvitationAcceptV1RequestSchema");
    const issueRequest = { targetEmail: "qa@example.test" };
    const acceptRequest = { token, name: "QA Operator", password: "synthetic-test-password" };

    expect(issue.parse(issueRequest)).toEqual(issueRequest);
    expect(accept.parse(acceptRequest)).toEqual(acceptRequest);
    for (const field of ["agencyId", "actorId", "roleId", "permissionIds", "ignored"]) {
      expect(issue.safeParse({ ...issueRequest, [field]: "caller-controlled" }).success).toBe(
        false,
      );
    }
    for (const field of [
      "email",
      "agencyId",
      "actorId",
      "actorStaffPrincipalId",
      "roleId",
      "permissionIds",
    ]) {
      expect(accept.safeParse({ ...acceptRequest, [field]: "caller-controlled" }).success).toBe(
        false,
      );
    }
  });

  it("defaults list pagination and rejects malformed or out-of-range limits and cursors", () => {
    const query = schema("AdminStaffInvitationListV1QuerySchema");

    expect(query.parse({})).toEqual({ limit: 25, cursor: null });
    expect(query.parse({ limit: "1", cursor: invitationId })).toEqual({
      limit: 1,
      cursor: invitationId,
    });
    expect(query.parse({ limit: "50" })).toEqual({ limit: 50, cursor: null });
    for (const limit of ["0", "51", "1.5", "abc", 25]) {
      expect(query.safeParse({ limit }).success).toBe(false);
    }
    expect(query.safeParse({ cursor: "not-a-uuid" }).success).toBe(false);
    expect(query.safeParse({ unexpected: "value" }).success).toBe(false);
  });

  it("bounds token and metadata shapes and excludes bearer tokens from list projections", () => {
    const accept = schema("AdminStaffInvitationAcceptV1RequestSchema");
    const metadataSchema = schema("AdminStaffInvitationMetadataV1Schema");
    const list = schema("AdminStaffInvitationListV1ResponseSchema");
    const oneTime = schema("AdminStaffInvitationOneTimeV1ResponseSchema");

    expect(
      accept.safeParse({ token, name: "QA", password: "synthetic-test-password" }).success,
    ).toBe(true);
    expect(
      accept.safeParse({ token: "A".repeat(42), name: "QA", password: "synthetic-test-password" })
        .success,
    ).toBe(false);
    expect(
      accept.safeParse({
        token: `${"A".repeat(42)}+`,
        name: "QA",
        password: "synthetic-test-password",
      }).success,
    ).toBe(false);
    expect(metadataSchema.parse(metadata)).toEqual(metadata);
    expect(metadataSchema.safeParse({ ...metadata, token }).success).toBe(false);
    expect(
      list.safeParse({
        items: Array.from({ length: 51 }, () => metadata),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(list.parse({ items: [metadata], nextCursor: invitationId })).toEqual({
      items: [metadata],
      nextCursor: invitationId,
    });
    expect(list.safeParse({ items: [{ ...metadata, token }], nextCursor: null }).success).toBe(
      false,
    );
    expect(oneTime.parse({ invitation: metadata, token })).toEqual({ invitation: metadata, token });
  });

  it("accepts the backward-compatible server-derived canInviteStaff hint only as a boolean", () => {
    expect(AdminStaffSessionContextSchema.parse(sessionContext)).toEqual(sessionContext);
    expect(
      AdminStaffSessionContextSchema.parse({ ...sessionContext, canInviteStaff: true }),
    ).toEqual({ ...sessionContext, canInviteStaff: true });
    expect(
      AdminStaffSessionContextSchema.safeParse({ ...sessionContext, canInviteStaff: "yes" })
        .success,
    ).toBe(false);
    expect(
      AdminStaffSessionContextSchema.safeParse({ ...sessionContext, role: "Owner" }).success,
    ).toBe(false);
  });
});
