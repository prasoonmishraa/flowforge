import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from "../db.js";
import { renewExecutionLease } from "./renewExecutionLease.js";

describe("renewExecutionLease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renews a lease for the current worker", async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "42",
          locked_until: "2026-10-30T11:05:00.000Z",
          last_heartbeat_at: "2026-10-30T11:04:00.000Z",
        },
      ],
    });

    const result = await renewExecutionLease("42", "worker-token");

    expect(result.id).toBe("42");
    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.query.mock.calls[0][1]).toEqual(["42", "worker-token"]);
    expect(pool.query.mock.calls[0][0]).toContain("worker_token = $2");
  });

  it("returns null when the worker no longer owns the lease", async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const result = await renewExecutionLease("42", "stale-token");

    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledOnce();
  });
});
