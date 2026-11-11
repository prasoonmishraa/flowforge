import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
  default: {
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import { startHeartbeat } from "./heartbeat.js";

describe("startHeartbeat", () => {
  let redis;

  beforeEach(() => {
    vi.useRealTimers();

    redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
  });

  it("creates an initial heartbeat with an expiry", async () => {
    const heartbeat = await startHeartbeat({
      redis,
      service: "worker",
    });

    expect(redis.set).toHaveBeenCalledOnce();

    const [key, value, expiryMode, ttl] = redis.set.mock.calls[0];

    expect(key).toContain("flowforge:health:worker:");
    expect(value).toBeTruthy();
    expect(expiryMode).toBe("EX");
    expect(ttl).toBe(30);

    await heartbeat.stop();
  });

  it("refreshes the heartbeat periodically", async () => {
    vi.useFakeTimers();

    const heartbeat = await startHeartbeat({
      redis,
      service: "worker",
      intervalMs: 1000,
    });

    expect(redis.set).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);

    expect(redis.set).toHaveBeenCalledTimes(2);

    await heartbeat.stop();
  });

  it("deletes its heartbeat during shutdown", async () => {
    const heartbeat = await startHeartbeat({
      redis,
      service: "publisher",
    });

    await heartbeat.stop();

    expect(redis.del).toHaveBeenCalledWith(heartbeat.key);
  });

  it("rejects a missing Redis connection", async () => {
    await expect(
      startHeartbeat({
        service: "worker",
      }),
    ).rejects.toThrow("Redis connection is required");
  });

  it("rejects a missing service name", async () => {
    await expect(
      startHeartbeat({
        redis,
      }),
    ).rejects.toThrow("Service name is required");
  });
});
