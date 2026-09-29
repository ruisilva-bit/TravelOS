import { describe, expect, it } from "vitest";

import {
  createOneTimeOperatorToken,
  digestOneTimeOperatorToken,
  verifyOneTimeOperatorToken,
} from "../src/operator-token.js";

describe("one-time local operator tokens", () => {
  it("returns a raw token only to the caller and persists/verifies its digest", () => {
    const token = createOneTimeOperatorToken();
    expect(token.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(token.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(token.digest).toBe(digestOneTimeOperatorToken(token.rawToken));
    expect(verifyOneTimeOperatorToken(token.rawToken, token.digest)).toBe(true);
    expect(verifyOneTimeOperatorToken(`${token.rawToken}x`, token.digest)).toBe(false);
  });
});
