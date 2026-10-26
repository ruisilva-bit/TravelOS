import { describe, expect, it } from "vitest";
import * as core from "../../src/index.js";

const exports = core as unknown as {
  workerRetryDelayMs?: (attempt: number, random: number) => number;
  workerFailureCode?: (error: unknown) => string;
};

describe("Stage 8 bounded worker policy", () => {
  it("exponentially backs off with bounded jitter without accepting malformed attempts", () => {
    expect(exports.workerRetryDelayMs).toBeTypeOf("function");
    const delay = exports.workerRetryDelayMs!;
    expect(delay(1, 0)).toBe(1000);
    expect(delay(2, 0)).toBe(2000);
    expect(delay(3, 1)).toBe(4800);
    expect(delay(100, 1)).toBe(60000);
    for (const attempt of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => delay(attempt, 0)).toThrow();
    }
    for (const random of [-1, 1.01, NaN, Infinity]) {
      expect(() => delay(1, random)).toThrow();
    }
  });

  it("never treats arbitrary provider/error text as a safe code or as retry permission", () => {
    expect(exports.workerFailureCode).toBeTypeOf("function");
    const classify = exports.workerFailureCode!;
    expect(classify(new Error("private contents"))).toBe("UNKNOWN_OUTCOME");
    expect(classify({ code: "TEMPORARY", message: "untrusted" })).toBe("UNKNOWN_OUTCOME");
    expect(classify(null)).toBe("UNKNOWN_OUTCOME");
  });
});
