import { describe, expect, it } from "vitest";
import * as telemetry from "../src/index.js";

const exports = telemetry as unknown as {
  createCorrelationContext?: (
    requestId?: unknown,
    traceparent?: unknown,
  ) => { correlationId: string; traceparent: string | null };
  runWithCorrelation?: <T>(
    context: { correlationId: string; traceparent: string | null },
    work: () => T,
  ) => T;
  currentCorrelationContext?: () => { correlationId: string; traceparent: string | null };
  createStructuredLogger?: (
    service: string,
    write: (line: string) => void,
  ) => (record: unknown) => void;
};

describe("Stage 8 allowlisted telemetry", () => {
  it("replaces hostile request IDs and validates W3C traceparent", () => {
    expect(exports.createCorrelationContext).toBeTypeOf("function");
    const create = exports.createCorrelationContext!;
    const id = "01900000-0000-7000-8000-000000000001";
    const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
    expect(create(id, traceparent)).toEqual({ correlationId: id, traceparent });
    expect(
      create(
        "customer@example.test\nsecret",
        "00-00000000000000000000000000000000-0123456789abcdef-01",
      ),
    ).toEqual({ correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u), traceparent: null });
  });

  it("preserves independent concurrent async correlation contexts", async () => {
    expect(exports.runWithCorrelation).toBeTypeOf("function");
    const contexts = [exports.createCorrelationContext!(), exports.createCorrelationContext!()];
    const results = await Promise.all(
      contexts.map((context) =>
        exports.runWithCorrelation!(context, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return exports.currentCorrelationContext!();
        }),
      ),
    );
    expect(results).toEqual(contexts);
    expect(results[0]?.correlationId).not.toBe(results[1]?.correlationId);
  });

  it("constructs logs rather than passing through objects, PII or raw errors", () => {
    expect(exports.createStructuredLogger).toBeTypeOf("function");
    const lines: string[] = [];
    const log = exports.createStructuredLogger!("worker", (line) => lines.push(line));
    log({
      action: "job_completed",
      outcome: "SUCCEEDED",
      durationMs: 3,
      errorCode: "TEMPORARY",
      secret: "private sentinel",
      email: "customer@example.test",
      message: "raw private error",
      request: { headers: { cookie: "private sentinel" } },
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      service: "worker",
      action: "job_completed",
      outcome: "SUCCEEDED",
      durationMs: 3,
      errorCode: "TEMPORARY",
    });
    expect(lines.join("")).not.toMatch(/private|customer|cookie|headers|message/u);
    log({ action: "customer@example.test", outcome: "secret", errorCode: "private sentinel" });
    expect(lines.join("")).not.toMatch(/private|customer|secret/u);
  });
});
