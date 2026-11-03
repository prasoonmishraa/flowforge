import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from "../db.js";
import { handleOutboxPublishFailure } from "./handleOutboxPublishFailure.js";

describe("handleOutboxPublishFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const event = {
    id: "15",
    lock_token: "test-lock-token",
  };

  it("records the failure and schedules a retry", async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "15",
          attempts: 1,
          next_attempt_at: "2026-11-03T12:00:01.000Z",
        },
      ],
    });

    const result = await handleOutboxPublishFailure(
      event,
      new Error("Redis unavailable"),
    );

    expect(pool.query).toHaveBeenCalledOnce();

    const [sql, params] = pool.query.mock.calls[0];

    expect(sql).toContain("attempts = attempts + 1");
    expect(sql).toContain("POWER(2, attempts)");
    expect(sql).toContain("lock_token = NULL");
    expect(sql).toContain("locked_until = NULL");

    expect(params).toEqual(["15", "test-lock-token", "Redis unavailable"]);

    expect(result).toEqual({
      handled: true,
      eventId: "15",
      attempts: 1,
      nextAttemptAt: "2026-11-03T12:00:01.000Z",
    });
  });

  it("returns false when publisher ownership has been lost", async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const result = await handleOutboxPublishFailure(
      event,
      new Error("Redis unavailable"),
    );

    expect(result).toEqual({
      handled: false,
      reason: "publisher_lease_lost",
    });
  });
});
