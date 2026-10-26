import { describe, expect, it } from "vitest";
import * as observability from "../src/index.js";

interface WorkerMetricSnapshot {
  readonly pending: number;
  readonly oldestPendingSeconds: number;
  readonly running: number;
  readonly retries: number;
  readonly deadLetter: number;
  readonly unknownOutcome: number;
  readonly expiredLeases: number;
}

const exports = observability as unknown as {
  serializeWorkerMetrics?: (snapshot: WorkerMetricSnapshot | null) => string;
};
const serialize = (snapshot: WorkerMetricSnapshot | null): string => {
  expect(exports.serializeWorkerMetrics).toBeTypeOf("function");
  return exports.serializeWorkerMetrics!(snapshot);
};
const stats: WorkerMetricSnapshot = {
  pending: 3,
  oldestPendingSeconds: 120,
  running: 2,
  retries: 4,
  deadLetter: 1,
  unknownOutcome: 1,
  expiredLeases: 2,
};

const expectedNames = [
  "travelos_worker_stats_available",
  "travelos_worker_jobs_pending",
  "travelos_worker_jobs_oldest_pending_seconds",
  "travelos_worker_jobs_running",
  "travelos_worker_jobs_retries",
  "travelos_worker_jobs_dead_letters",
  "travelos_worker_jobs_unknown_outcomes",
  "travelos_worker_jobs_expired_leases",
];

describe("private Stage 8 worker metrics exposition", () => {
  it("emits the fixed low-cardinality queue metrics as Prometheus gauges", () => {
    const output = serialize(stats);
    const sampleNames = output
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split(" ")[0]);

    expect(sampleNames).toEqual(expectedNames);
    expect(output).toContain("travelos_worker_stats_available 1\n");
    expect(output).toContain("travelos_worker_jobs_pending 3\n");
    expect(output).toContain("travelos_worker_jobs_oldest_pending_seconds 120\n");
    expect(output).toContain("travelos_worker_jobs_running 2\n");
    expect(output).toContain("travelos_worker_jobs_retries 4\n");
    expect(output).toContain("travelos_worker_jobs_dead_letters 1\n");
    expect(output).toContain("travelos_worker_jobs_unknown_outcomes 1\n");
    expect(output).toContain("travelos_worker_jobs_expired_leases 2\n");
    expect(output).toMatch(/\n$/u);
    expect(output).not.toMatch(/[{}]/u);
    expect(output).not.toMatch(/agency|trip|customer|principal/iu);
  });

  it("marks an unavailable snapshot without exporting stale queue values", () => {
    const output = serialize(null);
    expect(output).toContain("travelos_worker_stats_available 0\n");
    expect(output).not.toContain("travelos_worker_jobs_pending");
    expect(output).not.toContain("travelos_worker_jobs_running");
  });

  it.each([
    ["negative", { ...stats, pending: -1 }],
    ["fractional", { ...stats, oldestPendingSeconds: 0.5 }],
    ["non-finite", { ...stats, retries: Number.NaN }],
    ["unsafe integer", { ...stats, running: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects a %s metric value", (_label, invalid) => {
    expect(exports.serializeWorkerMetrics).toBeTypeOf("function");
    expect(() => exports.serializeWorkerMetrics!(invalid)).toThrow(
      "Worker metrics must be non-negative safe integers",
    );
  });
});
