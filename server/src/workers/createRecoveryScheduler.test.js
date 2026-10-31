import { describe, it, expect, vi } from "vitest";
import { createRecoveryScheduler } from "./createRecoveryScheduler.js";

describe("createRecoveryScheduler", () => {
  it("runs an initial recovery scan when started", async () => {
    const recoverExpiredExecutions = vi.fn().mockResolvedValue({
      scannedCount: 2,
      enqueuedCount: 2,
    });

    const schedule = vi.fn();

    const scheduler = createRecoveryScheduler({
      recoverExpiredExecutions,
      schedule,
    });

    await scheduler.start();

    expect(recoverExpiredExecutions).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it("runs another scan when the scheduled callback fires", async () => {
    const recoverExpiredExecutions = vi.fn().mockResolvedValue({
      scannedCount: 0,
      enqueuedCount: 0,
    });

    let scheduledCallback;

    const schedule = vi.fn((callback) => {
      scheduledCallback = callback;
      return 123;
    });

    const scheduler = createRecoveryScheduler({
      recoverExpiredExecutions,
      schedule,
    });

    await scheduler.start();

    scheduledCallback();
    await vi.waitFor(() => {
      expect(recoverExpiredExecutions).toHaveBeenCalledTimes(2);
    });
  });

  it("does not start overlapping recovery scans", async () => {
    let resolveSecondScan;
    let scheduledCallback;
    let callCount = 0;

    const recoverExpiredExecutions = vi.fn(() => {
      callCount += 1;

      if (callCount === 2) {
        return new Promise((resolve) => {
          resolveSecondScan = resolve;
        });
      }

      return Promise.resolve({
        scannedCount: 0,
        enqueuedCount: 0,
      });
    });

    const schedule = vi.fn((callback) => {
      scheduledCallback = callback;
      return 123;
    });

    const scheduler = createRecoveryScheduler({
      recoverExpiredExecutions,
      schedule,
    });

    await scheduler.start();

    // Start a second scan.
    scheduledCallback();

    await vi.waitFor(() => {
      expect(recoverExpiredExecutions).toHaveBeenCalledTimes(2);
    });

    // Attempt another scan while the second is still running.
    scheduledCallback();

    expect(recoverExpiredExecutions).toHaveBeenCalledTimes(2);

    resolveSecondScan({
      scannedCount: 0,
      enqueuedCount: 0,
    });
  });
  it("cancels the interval and waits for an active scan when stopped", async () => {
    let resolveSecondScan;
    let scheduledCallback;
    let callCount = 0;

    const recoverExpiredExecutions = vi.fn(() => {
      callCount += 1;

      if (callCount === 2) {
        return new Promise((resolve) => {
          resolveSecondScan = resolve;
        });
      }

      return Promise.resolve({
        scannedCount: 0,
        enqueuedCount: 0,
      });
    });

    const schedule = vi.fn((callback) => {
      scheduledCallback = callback;
      return 123;
    });

    const cancel = vi.fn();

    const scheduler = createRecoveryScheduler({
      recoverExpiredExecutions,
      schedule,
      cancel,
    });

    // Complete the initial scan and create the interval.
    await scheduler.start();

    expect(schedule).toHaveBeenCalledTimes(1);

    // Trigger the second scan. It remains active.
    scheduledCallback();

    await vi.waitFor(() => {
      expect(recoverExpiredExecutions).toHaveBeenCalledTimes(2);
    });

    // Request shutdown while the second scan is active.
    const stopPromise = scheduler.stop();

    expect(cancel).toHaveBeenCalledWith(123);

    let shutdownCompleted = false;

    stopPromise.then(() => {
      shutdownCompleted = true;
    });

    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);

    // Allow the active scan to finish.
    resolveSecondScan({
      scannedCount: 0,
      enqueuedCount: 0,
    });

    await stopPromise;

    expect(shutdownCompleted).toBe(true);
  });
});
