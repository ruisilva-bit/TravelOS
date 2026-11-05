import { createHash, randomBytes } from "node:crypto";

export interface StaffInvitationToken {
  readonly token: string;
  readonly digest: string;
}

export const digestStaffInvitationToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const createStaffInvitationToken = (): StaffInvitationToken => {
  const token = randomBytes(32).toString("base64url");
  return { token, digest: digestStaffInvitationToken(token) };
};
