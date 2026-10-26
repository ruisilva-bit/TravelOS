export interface WorkerMetricSnapshot {
  readonly pending: number;
  readonly oldestPendingSeconds: number;
  readonly running: number;
  readonly retries: number;
  readonly deadLetter: number;
  readonly unknownOutcome: number;
  readonly expiredLeases: number;
}

const metric = (name: string, help: string, value: number): string[] => [
  `# HELP ${name} ${help}`,
  `# TYPE ${name} gauge`,
  `${name} ${value}`,
];

export const serializeWorkerMetrics = (snapshot: WorkerMetricSnapshot | null): string => {
  const lines = metric(
    "travelos_worker_stats_available",
    "Whether current worker queue statistics are available.",
    snapshot === null ? 0 : 1,
  );
  if (snapshot === null) return `${lines.join("\n")}\n`;

  const values: readonly [string, string, number][] = [
    [
      "travelos_worker_jobs_pending",
      "Pending or retry jobs waiting for execution.",
      snapshot.pending,
    ],
    [
      "travelos_worker_jobs_oldest_pending_seconds",
      "Age in seconds of the oldest pending or retry job.",
      snapshot.oldestPendingSeconds,
    ],
    ["travelos_worker_jobs_running", "Jobs currently held by a worker.", snapshot.running],
    ["travelos_worker_jobs_retries", "Recorded retry attempts.", snapshot.retries],
    ["travelos_worker_jobs_dead_letters", "Jobs moved to dead letter.", snapshot.deadLetter],
    [
      "travelos_worker_jobs_unknown_outcomes",
      "Jobs quarantined with an unknown outcome.",
      snapshot.unknownOutcome,
    ],
    [
      "travelos_worker_jobs_expired_leases",
      "Running jobs with an expired lease.",
      snapshot.expiredLeases,
    ],
  ];
  if (values.some(([, , value]) => !Number.isSafeInteger(value) || value < 0))
    throw new Error("Worker metrics must be non-negative safe integers");
  for (const [name, help, value] of values) lines.push(...metric(name, help, value));
  return `${lines.join("\n")}\n`;
};
