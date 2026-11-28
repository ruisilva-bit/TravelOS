import { describe, expect, it, vi } from "vitest";

import { createQuoteExpiryTask, QUOTE_EXPIRY_INTERVAL_MS } from "../src/quote-expiry-task.js";

const makeClock = (start: number) => {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
};

describe("quote expiry task", () => {
  it("runs at start and then only once every 15 minutes", async () => {
    const clock = makeClock(1_000_000);
    const port = { expireQuotes: vi.fn(async () => 2) };
    const log = vi.fn();
    const task = createQuoteExpiryTask({ port, clock: clock.now, log });

    await task.tick();
    expect(port.expireQuotes).toHaveBeenCalledTimes(1);

    clock.advance(QUOTE_EXPIRY_INTERVAL_MS - 1);
    await task.tick();
    expect(port.expireQuotes).toHaveBeenCalledTimes(1);

    clock.advance(1);
    await task.tick();
    expect(port.expireQuotes).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith({
      action: "quote_expiry",
      outcome: "SUCCEEDED",
      expiredCount: 2,
    });
  });

  it("logs only the count, never the database message", async () => {
    const clock = makeClock(0);
    const log = vi.fn();
    const task = createQuoteExpiryTask({
      port: {
        expireQuotes: vi.fn(async () => {
          throw new Error('relation "sales.quote" with customer Marta Quintela');
        }),
      },
      clock: clock.now,
      log,
    });

    await expect(task.tick()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith({
      action: "quote_expiry",
      outcome: "FAILED",
      errorCode: "DATABASE_UNAVAILABLE",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Marta");
  });

  it("waits for the next interval after a failed sweep instead of retrying immediately", async () => {
    const clock = makeClock(0);
    const port = {
      expireQuotes: vi
        .fn<() => Promise<number>>()
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValueOnce(0),
    };
    const task = createQuoteExpiryTask({ port, clock: clock.now, log: vi.fn() });

    await task.tick();
    await task.tick();
    expect(port.expireQuotes).toHaveBeenCalledTimes(1);

    clock.advance(QUOTE_EXPIRY_INTERVAL_MS);
    await task.tick();
    expect(port.expireQuotes).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight sweep between overlapping ticks", async () => {
    const clock = makeClock(0);
    let release: (value: number) => void = () => undefined;
    const port = {
      expireQuotes: vi.fn(
        () =>
          new Promise<number>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const task = createQuoteExpiryTask({ port, clock: clock.now, log: vi.fn() });

    const first = task.tick();
    const second = task.tick();
    release(1);
    await Promise.all([first, second]);
    expect(port.expireQuotes).toHaveBeenCalledTimes(1);
  });
});
