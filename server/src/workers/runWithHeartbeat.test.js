import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./renewExecutionLease.js", () => ({
  renewExecutionLease: vi.fn(),
}));

import { renewExecutionLease } from "./renewExecutionLease.js";
import { runWithHeartbeat } from "./runWithHeartbeat.js";

describe("runWithHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews the lease periodically while the task is running", async () => {
    renewExecutionLease.mockResolvedValue({ id: "42" });

    let resolveTask;

    const task = () =>
      new Promise((resolve) => {
        resolveTask = resolve;
      });

    const processing = runWithHeartbeat("42", "worker-token", task);

    await vi.advanceTimersByTimeAsync(40_000);

    expect(renewExecutionLease).toHaveBeenCalledTimes(2);
    expect(renewExecutionLease).toHaveBeenNthCalledWith(
      1,
      "42",
      "worker-token",
    );

    resolveTask("completed");

    await expect(processing).resolves.toBe("completed");
  });

  it("rejects when the worker loses its lease", async () => {
    renewExecutionLease.mockResolvedValue(null);

    let taskSignal;

    const task = (signal) =>
      new Promise(() => {
        taskSignal = signal;
      });

    const processing = runWithHeartbeat("42", "worker-token", task);

    const assertion = expect(processing).rejects.toThrow(
      "Execution 42 lost its lease",
    );

    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;

    expect(taskSignal.aborted).toBe(true);
  });

  it("does not renew the lease after the task finishes", async () => {
    renewExecutionLease.mockResolvedValue({ id: "42" });

    const result = await runWithHeartbeat(
      "42",
      "worker-token",
      async () => "completed",
    );

    expect(result).toBe("completed");
    expect(renewExecutionLease).not.toHaveBeenCalled();
  });
});
