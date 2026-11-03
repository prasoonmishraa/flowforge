import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock("../queues/executionQueue.js", () => ({
  default: {
    add: vi.fn(),
  },
}));

import pool from "../db.js";
import executionQueue from "../queues/executionQueue.js";
import { publishOutboxEvent } from "./publishOutboxEvent.js";

describe("publishOutboxEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const event = {
    id: "15",
    event_type: "EXECUTION_REQUESTED",
    aggregate_id: "42",
    lock_token: "test-lock-token",
  };

  it("publishes the execution job and marks the event as published", async () => {
    executionQueue.add.mockResolvedValueOnce({
      id: "execution-42",
    });

    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "15" }],
    });

    const result = await publishOutboxEvent(event);

    expect(executionQueue.add).toHaveBeenCalledWith(
      "process-execution",
      { executionId: "42" },
      {
        jobId: "execution-42",
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    );

    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.query.mock.calls[0][1]).toEqual(["15", "test-lock-token"]);

    expect(result).toEqual({
      published: true,
      eventId: "15",
      executionId: "42",
    });
  });

  it("rejects unsupported event types", async () => {
    await expect(
      publishOutboxEvent({
        ...event,
        event_type: "UNKNOWN_EVENT",
      }),
    ).rejects.toThrow("Unsupported outbox event type");

    expect(executionQueue.add).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects events without a lock token", async () => {
    await expect(
      publishOutboxEvent({
        ...event,
        lock_token: null,
      }),
    ).rejects.toThrow("Outbox event is missing its lock token");

    expect(executionQueue.add).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("does not mark the event as published when Redis publishing fails", async () => {
    executionQueue.add.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(publishOutboxEvent(event)).rejects.toThrow(
      "Redis unavailable",
    );

    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns false when publisher ownership has been lost", async () => {
    executionQueue.add.mockResolvedValueOnce({
      id: "execution-42",
    });

    pool.query.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const result = await publishOutboxEvent(event);

    expect(result).toEqual({
      published: false,
      reason: "publisher_lease_lost",
    });

    expect(executionQueue.add).toHaveBeenCalledOnce();
    expect(pool.query).toHaveBeenCalledOnce();
  });
});
