// Periodic quote expiry: runs at start and then every 15 minutes. It only logs counts, never quote
// numbers, customers or other personal data.

export const QUOTE_EXPIRY_INTERVAL_MS = 15 * 60 * 1000;

export interface QuoteExpiryPort {
  readonly expireQuotes: () => Promise<number>;
}

export interface QuoteExpiryTaskOptions {
  readonly port: QuoteExpiryPort;
  readonly clock: () => number;
  readonly log: (record: unknown) => void;
  readonly intervalMs?: number;
}

export interface QuoteExpiryTask {
  /** Runs the sweep when it is due; overlapping calls share the run in flight. */
  readonly tick: () => Promise<void>;
}

export const createQuoteExpiryTask = (options: QuoteExpiryTaskOptions): QuoteExpiryTask => {
  const intervalMs = options.intervalMs ?? QUOTE_EXPIRY_INTERVAL_MS;
  // The first tick is always due, so a freshly started worker expires overdue quotes at once.
  let nextRunAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  const run = async (): Promise<void> => {
    try {
      const expired = await options.port.expireQuotes();
      options.log({ action: "quote_expiry", outcome: "SUCCEEDED", expiredCount: expired });
    } catch {
      // The failure kind only: driver messages can carry query text, so they are not logged.
      options.log({ action: "quote_expiry", outcome: "FAILED", errorCode: "DATABASE_UNAVAILABLE" });
    }
  };

  return {
    tick: async () => {
      if (inFlight !== null) return inFlight;
      const now = options.clock();
      if (now < nextRunAt) return;
      // Scheduled before the run, so a failed sweep waits for the next interval instead of retrying hot.
      nextRunAt = now + intervalMs;
      inFlight = run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
};
