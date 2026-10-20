import { describe, expect, it } from "vitest";
import * as realm from "../src/realm.js";

type SessionContextInput = {
  readonly agencyId: string;
  readonly sessionAuthorizationEpoch: string;
  readonly principalAuthorizationEpoch: string;
  readonly principalRetiredAt: Date | null;
};
type SessionContextResult = {
  readonly agencyId: string;
  readonly authorizationEpoch: string;
} | null;
type Resolver = (input: SessionContextInput) => SessionContextResult;
const resolveCurrentContext = (
  realm as unknown as {
    readonly resolveCurrentPortalSessionContext?: Resolver;
  }
).resolveCurrentPortalSessionContext;

describe("Portal session resolution after principal retirement", () => {
  it("rejects existing sessions whose authorization epoch was invalidated", () => {
    expect(resolveCurrentContext).toBeTypeOf("function");
    if (resolveCurrentContext === undefined) return;
    expect(
      resolveCurrentContext({
        agencyId: "abcdef12-3456-7abc-8def-000000000001",
        sessionAuthorizationEpoch: "4",
        principalAuthorizationEpoch: "5",
        principalRetiredAt: null,
      }),
    ).toBeNull();
  });

  it("rejects retired principals while keeping unrelated active principals usable", () => {
    expect(resolveCurrentContext).toBeTypeOf("function");
    if (resolveCurrentContext === undefined) return;
    expect(
      resolveCurrentContext({
        agencyId: "abcdef12-3456-7abc-8def-000000000001",
        sessionAuthorizationEpoch: "1",
        principalAuthorizationEpoch: "2",
        principalRetiredAt: new Date("2026-10-20T12:00:00.000Z"),
      }),
    ).toBeNull();
    expect(
      resolveCurrentContext({
        agencyId: "abcdef12-3456-7abc-8def-000000000002",
        sessionAuthorizationEpoch: "7",
        principalAuthorizationEpoch: "7",
        principalRetiredAt: null,
      }),
    ).toEqual({
      agencyId: "abcdef12-3456-7abc-8def-000000000002",
      authorizationEpoch: "7",
    });
  });
});
