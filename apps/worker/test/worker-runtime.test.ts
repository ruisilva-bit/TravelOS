import { describe, expect, it } from "vitest";
import {
  WorkerExecutionError,
  type WorkerClaim,
  type WorkerHandler,
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
const fixture = () => {
  let queued = true;
  const failures: { code: string; delay: number }[] = [];
  const repository: WorkerRepository = {
    ready: async () => true,
    recover: async () => 0,
    claim: async () => {
      if (!queued) return null;
      queued = false;
      return lease;
    },
    heartbeat: async (current) => ({ ...current, version: "2" }),
    complete: async (current, handler) => {
      await handler(current);
      return true;
    },
    fail: async (_claim, code, delay) => {
      failures.push({ code, delay });
      return true;
    },
    inspect: async () => stats,
  };
  return { repository, failures };
};
const start = (repository: WorkerRepository, handler: WorkerHandler) =>
  (
    bootstrapWorkerProcess as unknown as (options: {
      repository: WorkerRepository;
      owner: string;
      log: (event: unknown) => void;
      random: () => number;
      handler: WorkerHandler;
    }) => {
      state(): string;
      tick(): Promise<void>;
      diagnostics(): { live: boolean; ready: boolean; stats: WorkerStats | null };
      shutdown(): Promise<void>;
    }
  )({ repository, owner: lease.owner, log: () => {}, random: () => 0, handler });

describe("Stage 8 real worker lifecycle", () => {
  it("runs registered work and reports independent readiness and metrics", async () => {
    let executed = 0;
    const { repository } = fixture();
    const process = start(repository, async () => {
      executed += 1;
    });
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

  it("stays idle and never claims when no consumer is registered", async () => {
    const { repository, failures } = fixture();
    let claimed = 0;
    repository.claim = async () => {
      claimed += 1;
      return lease;
    };
    const process = (
      bootstrapWorkerProcess as unknown as (options: {
        repository: WorkerRepository;
        owner: string;
        log: (event: unknown) => void;
      }) => {
        tick(): Promise<void>;
        diagnostics(): { live: boolean; ready: boolean; stats: WorkerStats | null };
        shutdown(): Promise<void>;
      }
    )({ repository, owner: lease.owner, log: () => {} });
    await process.tick();
    expect(claimed).toBe(0);
    expect(failures).toEqual([]);
    expect(process.diagnostics().ready).toBe(true);
    await process.shutdown();
  });

  it.each([
    [new WorkerExecutionError("TEMPORARY"), "TEMPORARY"],
    [new WorkerExecutionError("PERMANENT"), "PERMANENT"],
    [new Error("private raw provider error"), "UNKNOWN_OUTCOME"],
  ])("uses typed failure disposition without unsafe replay", async (error, expected) => {
    const { repository, failures } = fixture();
    const process = start(repository, async () => {
      throw error;
    });
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
    const { repository } = fixture();
    const process = start(repository, async () => {
      entered();
      await gate;
    });
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
    const { repository } = fixture();
    repository.ready = async () => false;
    const process = start(repository, async () => {
      executed = true;
    });
    await expect(process.tick()).rejects.toThrow();
    expect(executed).toBe(false);
    expect(process.diagnostics().ready).toBe(false);
    await process.shutdown();
  });
});
