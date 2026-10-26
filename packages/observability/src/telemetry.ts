import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface CorrelationContext {
  readonly correlationId: string;
  readonly traceparent: string | null;
}

const contextStorage = new AsyncLocalStorage<CorrelationContext>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const trace = /^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/u;

export const createCorrelationContext = (
  requestId?: unknown,
  traceparent?: unknown,
): CorrelationContext => {
  const match = typeof traceparent === "string" ? trace.exec(traceparent) : null;
  return {
    correlationId: typeof requestId === "string" && uuid.test(requestId) ? requestId : randomUUID(),
    traceparent:
      match !== null && match[1] !== "0".repeat(32) && match[2] !== "0".repeat(16)
        ? match[0]
        : null,
  };
};

export const runWithCorrelation = <T>(context: CorrelationContext, work: () => T): T =>
  contextStorage.run(createCorrelationContext(context.correlationId, context.traceparent), work);

export const currentCorrelationContext = (): CorrelationContext =>
  contextStorage.getStore() ?? createCorrelationContext();

const actions = new Set([
  "process_bootstrap",
  "process_shutdown",
  "process_bootstrap_failed",
  "worker_cycle",
  "worker_ready",
  "job_completed",
  "job_failed",
  "lease_lost",
  "http_request",
]);
const outcomes = new Set([
  "SUCCEEDED",
  "RETRY",
  "DEAD_LETTER",
  "UNKNOWN_OUTCOME",
  "READY",
  "NOT_READY",
  "STOPPED",
  "FAILED",
  "LEASE_LOST",
]);
const codes = new Set([
  "TEMPORARY",
  "PERMANENT",
  "UNKNOWN_OUTCOME",
  "DATABASE_UNAVAILABLE",
  "INVALID_CONFIGURATION",
  "LEASE_LOST",
]);
const services = new Set(["admin-api", "portal-api", "worker"]);

export const createStructuredLogger = (
  service: string,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
) => {
  if (!services.has(service)) throw new Error("Invalid telemetry service");
  return (input: unknown): void => {
    if (typeof input !== "object" || input === null) return;
    const record = input as Record<string, unknown>;
    const context = currentCorrelationContext();
    const safe: Record<string, string | number | null> = {
      timestamp: new Date().toISOString(),
      level: record["outcome"] === "FAILED" ? "error" : "info",
      service,
      correlationId: context.correlationId,
      traceparent: context.traceparent,
      action:
        typeof record["action"] === "string" && actions.has(record["action"])
          ? record["action"]
          : "worker_cycle",
    };
    for (const [key, allowed] of [
      ["outcome", outcomes],
      ["errorCode", codes],
    ] as const) {
      const value = record[key];
      if (typeof value === "string" && allowed.has(value)) safe[key] = value;
    }
    for (const key of [
      "durationMs",
      "statusCode",
      "pending",
      "running",
      "succeeded",
      "retries",
      "deadLetter",
      "unknownOutcome",
      "expiredLeases",
      "oldestPendingSeconds",
    ]) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = value;
    }
    write(JSON.stringify(safe));
  };
};

export interface CorrelatedRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}
export interface CorrelatedResponse {
  readonly statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: "finish", listener: () => void): unknown;
}

export const createRequestTelemetry = (
  service: "admin-api" | "portal-api",
  write?: (line: string) => void,
) => {
  const log = createStructuredLogger(service, write);
  return (request: CorrelatedRequest, response: CorrelatedResponse, next: () => void): void => {
    const context = createCorrelationContext(
      request.headers["x-request-id"],
      request.headers["traceparent"],
    );
    const started = performance.now();
    response.setHeader("x-request-id", context.correlationId);
    runWithCorrelation(context, () => {
      response.once("finish", () =>
        runWithCorrelation(context, () =>
          log({
            action: "http_request",
            statusCode: response.statusCode,
            durationMs: Math.round(performance.now() - started),
          }),
        ),
      );
      next();
    });
  };
};
