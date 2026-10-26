import { describe, expect, it } from "vitest";
import {
  WorkerExecutionError,
  type WorkerClaim,
  type WorkerRepository,
  type WorkerStats,
} from "@travelos/backend-core";
import { bootstrapWorkerProcess } from "../src/worker-process.js";

const stats: WorkerStats = {
  pending: 0,
  running: 0,
  succeeded: 0,
  retries: 0,
  deadLetter: 0,
  unknownOutcome: 0,
  expiredLeases: 0,
  oldestPendingSeconds: 0,
};
const lease: WorkerClaim = {
  messageId: "01900000-0000-7000-8000-000000000001",
  agencyId: "01900000-0000-7000-8000-000000000002",
  owner: "01900000-0000-7000-8000-000000000003",
  version: "1",
  attempt: 1,
  correlationId: "01900000-0000-7000-8000-000000000004",
  traceparent: null,
};
const fixture = (effect: () => Promise<boolean>) => {
  let queued = true;
  const failures: { code: string; delay: number }[] = [];
  const repository: WorkerRepository = {
    ready: async () => true,
    dispatch: async () => 0,
    recover: async () => 0,
    claim: async () => {
      if (!queued) return null;
      queued = false;
      return lease;
    },
    heartbeat: async (current) => ({ ...current, version: "2" }),
    projectAndComplete: effect,
    fail: async (_claim, code, delay) => {
      failures.push({ code, delay });
      return true;
    },
    inspect: async () => stats,
  };
  return { repository, failures };
};
const start = (repository: WorkerRepository) =>
  (
    bootstrapWorkerProcess as unknown as (options: {
      repository: WorkerRepository;
      owner: string;
      log: (event: unknown) => void;
      random: () => number;
    }) => {
      state(): string;
      tick(): Promise<void>;
      diagnostics(): { live: boolean; ready: boolean; stats: WorkerStats | null };
      shutdown(): Promise<void>;
    }
  )({ repository, owner: lease.owner, log: () => {}, random: () => 0 });

describe("Stage 8 real worker lifecycle", () => {
  it("runs real port work and reports independent readiness and metrics", async () => {
    let executed = 0;
    const { repository } = fixture(async () => {
      executed += 1;
      return true;
    });
    const process = start(repository);
    expect(process.tick).toBeTypeOf("function");
    expect(process.diagnostics().ready).toBe(false);
    await process.tick();
    expect(executed).toBe(1);
    expect(process.diagnostics()).toEqual({ live: true, ready: true, stats });
    await process.shutdown();
    await process.tick();
    expect(executed).toBe(1);
    expect(process.diagnostics().live).toBe(false);
  });

  it.each([
    [new WorkerExecutionError("TEMPORARY"), "TEMPORARY"],
    [new WorkerExecutionError("PERMANENT"), "PERMANENT"],
    [new Error("private raw provider error"), "UNKNOWN_OUTCOME"],
  ])("uses typed failure disposition without unsafe replay", async (error, expected) => {
    const { repository, failures } = fixture(async () => {
      throw error;
    });
    const process = start(repository);
    await process.tick();
    expect(failures).toEqual([{ code: expected, delay: expected === "TEMPORARY" ? 1000 : 0 }]);
    await process.shutdown();
  });

  it("stops new claims and drains current work before shutdown resolves", async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { repository } = fixture(async () => {
      entered();
      await gate;
      return true;
    });
    const process = start(repository);
    const work = process.tick();
    await enteredPromise;
    let stopped = false;
    const shutdown = process.shutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(process.state()).toBe("DRAINING");
    release();
    await Promise.all([work, shutdown]);
    expect(process.state()).toBe("STOPPED");
  });

  it("fails readiness without claiming when DB identity is wrong", async () => {
    let executed = false;
    const { repository } = fixture(async () => {
      executed = true;
      return true;
    });
    repository.ready = async () => false;
    const process = start(repository);
    await expect(process.tick()).rejects.toThrow();
    expect(executed).toBe(false);
    expect(process.diagnostics().ready).toBe(false);
    await process.shutdown();
  });
});
