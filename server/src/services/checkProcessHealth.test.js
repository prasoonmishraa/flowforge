import { describe, expect, it, vi } from "vitest";

import { checkProcessHealth } from "./checkProcessHealth.js";

describe("checkProcessHealth", () => {
  it("reports up when an active heartbeat exists", async () => {
    const redis = {
      scan: vi
        .fn()
        .mockResolvedValueOnce(["0", ["flowforge:health:worker:process-1"]]),
      ttl: vi.fn().mockResolvedValueOnce(20),
    };

    const result = await checkProcessHealth(redis, "worker");

    expect(result).toEqual({
      status: "up",
      activeInstances: 1,
    });

    expect(redis.scan).toHaveBeenCalledWith(
      "0",
      "MATCH",
      "flowforge:health:worker:*",
      "COUNT",
      100,
    );
  });

  it("reports down when no heartbeat exists", async () => {
    const redis = {
      scan: vi.fn().mockResolvedValueOnce(["0", []]),
      ttl: vi.fn(),
    };

    const result = await checkProcessHealth(redis, "worker");

    expect(result).toEqual({
      status: "down",
      activeInstances: 0,
    });

    expect(redis.ttl).not.toHaveBeenCalled();
  });

  it("ignores expired heartbeat keys", async () => {
    const redis = {
      scan: vi
        .fn()
        .mockResolvedValueOnce([
          "0",
          [
            "flowforge:health:worker:process-1",
            "flowforge:health:worker:process-2",
          ],
        ]),
      ttl: vi.fn().mockResolvedValueOnce(-2).mockResolvedValueOnce(-1),
    };

    const result = await checkProcessHealth(redis, "worker");

    expect(result).toEqual({
      status: "down",
      activeInstances: 0,
    });
  });

  it("counts multiple active instances", async () => {
    const redis = {
      scan: vi
        .fn()
        .mockResolvedValueOnce([
          "0",
          [
            "flowforge:health:worker:process-1",
            "flowforge:health:worker:process-2",
            "flowforge:health:worker:process-3",
          ],
        ]),
      ttl: vi
        .fn()
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(-2),
    };

    const result = await checkProcessHealth(redis, "worker");

    expect(result).toEqual({
      status: "up",
      activeInstances: 2,
    });
  });

  it("continues scanning when Redis returns another cursor", async () => {
    const redis = {
      scan: vi
        .fn()
        .mockResolvedValueOnce(["42", ["flowforge:health:publisher:process-1"]])
        .mockResolvedValueOnce(["0", ["flowforge:health:publisher:process-2"]]),
      ttl: vi.fn().mockResolvedValueOnce(20).mockResolvedValueOnce(25),
    };

    const result = await checkProcessHealth(redis, "publisher");

    expect(redis.scan).toHaveBeenCalledTimes(2);

    expect(result).toEqual({
      status: "up",
      activeInstances: 2,
    });
  });
});
