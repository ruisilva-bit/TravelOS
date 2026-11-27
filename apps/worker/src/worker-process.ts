import {
  processWorkerClaim,
  type WorkerHandler,
  type WorkerRepository,
  type WorkerStats,
} from "@travelos/backend-core";
import { runWithCorrelation } from "@travelos/observability";

export type WorkerProcessState = "RUNNING" | "DRAINING" | "STOPPED";

export interface WorkerProcess {
  readonly state: () => WorkerProcessState;
  readonly shutdown: () => Promise<void>;
  readonly tick: () => Promise<void>;
  readonly diagnostics: () => { live: boolean; ready: boolean; stats: WorkerStats | null };
}

export interface WorkerProcessOptions {
  readonly repository: WorkerRepository;
  readonly owner: string;
  readonly log: (record: unknown) => void;
  readonly random?: () => number;
  /** No consumer is registered by default; without one the process stays idle and never claims. */
  readonly handler?: WorkerHandler;
}

export const bootstrapWorkerProcess = (options?: WorkerProcessOptions): WorkerProcess => {
  let currentState: WorkerProcessState = "RUNNING";
  let ready = false;
  let stats: WorkerStats | null = null;
  let inFlight: Promise<void> | null = null;
  const cycle = async (): Promise<void> => {
    if (options === undefined) return;
    const repository = options.repository;
    try {
      ready = await repository.ready();
      if (!ready) throw new Error("Worker database identity not ready");
      await repository.recover();
      if (currentState !== "RUNNING") return;
      const handler = options.handler;
      const claim = handler === undefined ? null : await repository.claim(options.owner);
      if (handler !== undefined && claim !== null)
        await runWithCorrelation(
          { correlationId: claim.correlationId, traceparent: claim.traceparent },
          async () => {
            const started = performance.now();
            const outcome = await processWorkerClaim(
              repository,
              claim,
              options.random ?? Math.random,
              handler,
            );
            options.log({
              action: outcome.outcome === "SUCCEEDED" ? "job_completed" : "job_failed",
              outcome: outcome.outcome,
              errorCode: outcome.errorCode,
              durationMs: Math.round(performance.now() - started),
            });
          },
        );
      stats = await repository.inspect();
      options.log({ action: "worker_cycle", outcome: "READY", ...stats });
    } catch (error) {
      ready = false;
      options.log({
        action: "worker_cycle",
        outcome: "NOT_READY",
        errorCode: "DATABASE_UNAVAILABLE",
      });
      throw error;
    }
  };

  return {
    state: () => currentState,
    diagnostics: () => ({
      live: currentState === "RUNNING",
      ready: currentState === "RUNNING" && ready,
      stats,
    }),
    tick: async () => {
      if (currentState !== "RUNNING") return;
      if (inFlight !== null) return inFlight;
      inFlight = cycle();
      try {
        await inFlight;
      } finally {
        inFlight = null;
      }
    },
    shutdown: async () => {
      if (currentState === "STOPPED") return;
      currentState = "DRAINING";
      await inFlight?.catch(() => undefined);
      ready = false;
      currentState = "STOPPED";
    },
  };
};
