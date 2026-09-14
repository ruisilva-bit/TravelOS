import { describe, expect, it } from "vitest";

import { bootstrapWorkerProcess } from "../src/worker-process.js";

describe("Worker process lifecycle", () => {
  it("boots and shuts down without claiming or executing work", async () => {
    const worker = bootstrapWorkerProcess();
    expect(worker.state()).toBe("RUNNING");
    await worker.shutdown();
    expect(worker.state()).toBe("STOPPED");
  });
});
