import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from "../db.js";
import { findExpiredExecutions } from "./findExpiredExecutions.js";

describe("findExpiredExecutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns expired executions from the database", async () => {
    const expiredExecutions = [
      {
        id: "42",
        workflow_id: "1",
        status: "running",
        worker_token: "worker-token",
        locked_until: new Date("2026-10-30T10:00:00Z"),
      },
    ];

    pool.query.mockResolvedValueOnce({
      rows: expiredExecutions,
    });

    const result = await findExpiredExecutions();

    expect(result).toEqual(expiredExecutions);
    expect(pool.query).toHaveBeenCalledOnce();

    const query = pool.query.mock.calls[0][0];

    expect(query).toContain("status = 'running'");
    expect(query).toContain("locked_until <= NOW()");
    expect(query).toContain("ORDER BY locked_until ASC");
  });

  it("returns an empty array when no expired executions exist", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [],
    });

    const result = await findExpiredExecutions();

    expect(result).toEqual([]);
  });

  it("propagates database errors", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database unavailable"));

    await expect(findExpiredExecutions()).rejects.toThrow(
      "Database unavailable",
    );
  });
});
