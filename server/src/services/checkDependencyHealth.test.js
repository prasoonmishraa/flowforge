import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  ping: vi.fn(),
  checkProcessHealth: vi.fn(),
}));

vi.mock("../db.js", () => ({
  default: {
    query: mocks.query,
  },
}));

vi.mock("ioredis", () => ({
  default: class MockRedis {
    ping = mocks.ping;
  },
}));

vi.mock("./checkProcessHealth.js", () => ({
  checkProcessHealth: mocks.checkProcessHealth,
}));

import { checkDependencyHealth } from "./checkDependencyHealth.js";

describe("checkDependencyHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.query.mockResolvedValue({
      rows: [{ "?column?": 1 }],
    });

    mocks.ping.mockResolvedValue("PONG");

    mocks.checkProcessHealth.mockImplementation(async (redis, service) => ({
      status: "up",
      activeInstances: 1,
    }));
  });

  it("reports healthy when all dependencies and processes are available", async () => {
    const result = await checkDependencyHealth();

    expect(result).toEqual({
      status: "ok",
      dependencies: {
        postgres: { status: "up" },
        redis: { status: "up" },
      },
      processes: {
        worker: { status: "up", activeInstances: 1 },
        publisher: { status: "up", activeInstances: 1 },
      },
    });

    expect(mocks.query).toHaveBeenCalledWith("SELECT 1");
    expect(mocks.ping).toHaveBeenCalledOnce();
    expect(mocks.checkProcessHealth).toHaveBeenCalledTimes(2);
  });

  it("reports degraded when PostgreSQL is unavailable", async () => {
    mocks.query.mockRejectedValueOnce(new Error("PostgreSQL unavailable"));

    const result = await checkDependencyHealth();

    expect(result.status).toBe("degraded");
    expect(result.dependencies.postgres.status).toBe("down");
    expect(result.dependencies.redis.status).toBe("up");
  });

  it("reports degraded when Redis is unavailable", async () => {
    mocks.ping.mockRejectedValueOnce(new Error("Redis unavailable"));

    const result = await checkDependencyHealth();

    expect(result.status).toBe("degraded");
    expect(result.dependencies.redis.status).toBe("down");
  });

  it("reports degraded when the worker has no active heartbeat", async () => {
    mocks.checkProcessHealth.mockImplementation(async (redis, service) => ({
      status: service === "worker" ? "down" : "up",
      activeInstances: service === "worker" ? 0 : 1,
    }));

    const result = await checkDependencyHealth();

    expect(result.status).toBe("degraded");
    expect(result.processes.worker.status).toBe("down");
    expect(result.processes.publisher.status).toBe("up");
  });

  it("reports degraded when the publisher has no active heartbeat", async () => {
    mocks.checkProcessHealth.mockImplementation(async (redis, service) => ({
      status: service === "publisher" ? "down" : "up",
      activeInstances: service === "publisher" ? 0 : 1,
    }));

    const result = await checkDependencyHealth();

    expect(result.status).toBe("degraded");
    expect(result.processes.publisher.status).toBe("down");
  });

  it("reports degraded when a process health check throws", async () => {
    mocks.checkProcessHealth.mockImplementation(async (redis, service) => {
      if (service === "worker") {
        throw new Error("Redis scan failed");
      }

      return {
        status: "up",
        activeInstances: 1,
      };
    });

    const result = await checkDependencyHealth();

    expect(result.status).toBe("degraded");
    expect(result.processes.worker).toEqual({
      status: "down",
      activeInstances: 0,
    });
    expect(result.processes.publisher.status).toBe("up");
  });

  it("reports degraded when both PostgreSQL and Redis are unavailable", async () => {
    mocks.query.mockRejectedValueOnce(new Error("PostgreSQL unavailable"));

    mocks.ping.mockRejectedValueOnce(new Error("Redis unavailable"));

    const result = await checkDependencyHealth();

    expect(result.status).toBe("degraded");
    expect(result.dependencies.postgres.status).toBe("down");
    expect(result.dependencies.redis.status).toBe("down");
  });
});
