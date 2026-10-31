import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../queues/executionQueue.js", () => ({
  default: {
    add: vi.fn(),
  },
}));

vi.mock("./findExpiredExecutions.js", () => ({
  findExpiredExecutions: vi.fn(),
}));

import executionQueue from "../queues/executionQueue.js";
import { findExpiredExecutions } from "./findExpiredExecutions.js";
import { recoverExpiredExecutions } from "./recoverExpiredExecutions.js";

describe("recoverExpiredExecutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-enqueues expired executions with deterministic job IDs", async () => {
    findExpiredExecutions.mockResolvedValueOnce([
      {
        id: "42",
        locked_until: new Date("2026-10-30T10:00:00.000Z"),
      },
      {
        id: "43",
        locked_until: new Date("2026-10-30T11:00:00.000Z"),
      },
    ]);

    executionQueue.add.mockResolvedValue({});

    const result = await recoverExpiredExecutions();

    expect(result).toEqual({
      scannedCount: 2,
      enqueuedCount: 2,
    });

    expect(executionQueue.add).toHaveBeenCalledTimes(2);

    expect(executionQueue.add).toHaveBeenNthCalledWith(
      1,
      "process-execution",
      { executionId: "42" },
      expect.objectContaining({
        jobId: `recovery-42-${new Date("2026-10-30T10:00:00.000Z").getTime()}`,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });

  it("does not enqueue anything when no expired executions exist", async () => {
    findExpiredExecutions.mockResolvedValueOnce([]);

    const result = await recoverExpiredExecutions();

    expect(result).toEqual({
      scannedCount: 0,
      enqueuedCount: 0,
    });

    expect(executionQueue.add).not.toHaveBeenCalled();
  });

  it("propagates queue errors", async () => {
    findExpiredExecutions.mockResolvedValueOnce([
      {
        id: "42",
        locked_until: new Date("2026-10-30T10:00:00.000Z"),
      },
    ]);

    executionQueue.add.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(recoverExpiredExecutions()).rejects.toThrow(
      "Redis unavailable",
    );
  });
  it("generates the same recovery job ID for the same expired lease", async () => {
    const lockedUntil = new Date("2026-10-30T10:00:00.000Z");

    findExpiredExecutions.mockResolvedValue([
      {
        id: "42",
        locked_until: lockedUntil,
      },
    ]);

    executionQueue.add.mockResolvedValue({});

    await Promise.all([recoverExpiredExecutions(), recoverExpiredExecutions()]);

    expect(executionQueue.add).toHaveBeenCalledTimes(2);

    const firstJobId = executionQueue.add.mock.calls[0][2].jobId;
    const secondJobId = executionQueue.add.mock.calls[1][2].jobId;

    expect(firstJobId).toBe(secondJobId);
  });
});
