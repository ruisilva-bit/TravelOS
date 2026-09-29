import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface OneTimeOperatorToken {
  /** Returned only to the local operator delivery channel and never persisted. */
  readonly rawToken: string;
  /** The only token representation eligible for persistence. */
  readonly digest: string;
}

export const digestOneTimeOperatorToken = (rawToken: string): string =>
  createHash("sha256").update(rawToken, "utf8").digest("hex");

export const createOneTimeOperatorToken = (): OneTimeOperatorToken => {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, digest: digestOneTimeOperatorToken(rawToken) };
};

export const verifyOneTimeOperatorToken = (rawToken: string, expectedDigest: string): boolean => {
  const actual = Buffer.from(digestOneTimeOperatorToken(rawToken), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
