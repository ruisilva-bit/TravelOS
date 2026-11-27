export type WorkerErrorCode = "TEMPORARY" | "PERMANENT" | "UNKNOWN_OUTCOME";

export class WorkerExecutionError extends Error {
  constructor(readonly code: WorkerErrorCode) {
    super(code);
    this.name = "WorkerExecutionError";
  }
}

export const workerFailureCode = (error: unknown): WorkerErrorCode =>
  error instanceof WorkerExecutionError ? error.code : "UNKNOWN_OUTCOME";

export const workerRetryDelayMs = (attempt: number, random: number): number => {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !Number.isFinite(random) ||
    random < 0 ||
    random > 1
  ) {
    throw new Error("Invalid worker retry inputs");
  }
  return Math.min(60_000, Math.floor(1000 * 2 ** Math.min(attempt - 1, 6) * (1 + random / 5)));
};

export interface WorkerClaim {
  readonly messageId: string;
  readonly agencyId: string;
  readonly owner: string;
  readonly version: string;
  readonly attempt: number;
  readonly correlationId: string;
  readonly traceparent: string | null;
}

export interface WorkerStats {
  readonly pending: number;
  readonly running: number;
  readonly succeeded: number;
  readonly retries: number;
  readonly deadLetter: number;
  readonly unknownOutcome: number;
  readonly expiredLeases: number;
  readonly oldestPendingSeconds: number;
}

/** A consumer's work for one claimed job. It runs inside the completion transaction; throw to fail. */
export type WorkerHandler = (claim: WorkerClaim) => Promise<void>;

export interface WorkerRepository {
  ready(): Promise<boolean>;
  recover(): Promise<number>;
  claim(owner: string): Promise<WorkerClaim | null>;
  heartbeat(claim: WorkerClaim): Promise<WorkerClaim | null>;
  complete(claim: WorkerClaim, handler: WorkerHandler): Promise<boolean>;
  fail(claim: WorkerClaim, code: WorkerErrorCode, retryDelayMs: number): Promise<boolean>;
  inspect(): Promise<WorkerStats>;
}

export interface WorkerOutcome {
  readonly outcome: "SUCCEEDED" | "RETRY" | "DEAD_LETTER" | "UNKNOWN_OUTCOME" | "LEASE_LOST";
  readonly errorCode: WorkerErrorCode | "LEASE_LOST" | null;
}

export const processWorkerClaim = async (
  repository: WorkerRepository,
  initial: WorkerClaim,
  random: () => number,
  handler: WorkerHandler,
): Promise<WorkerOutcome> => {
  const claim = await repository.heartbeat(initial);
  if (claim === null) return { outcome: "LEASE_LOST", errorCode: "LEASE_LOST" };
  try {
    return (await repository.complete(claim, handler))
      ? { outcome: "SUCCEEDED", errorCode: null }
      : { outcome: "LEASE_LOST", errorCode: "LEASE_LOST" };
  } catch (error) {
    const code = workerFailureCode(error);
    const delay = code === "TEMPORARY" ? workerRetryDelayMs(claim.attempt, random()) : 0;
    if (!(await repository.fail(claim, code, delay)))
      return { outcome: "LEASE_LOST", errorCode: "LEASE_LOST" };
    return {
      outcome:
        code === "UNKNOWN_OUTCOME"
          ? "UNKNOWN_OUTCOME"
          : code === "PERMANENT" || claim.attempt >= 5
            ? "DEAD_LETTER"
            : "RETRY",
      errorCode: code,
    };
  }
};
