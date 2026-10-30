import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from "../db.js";
import { claimExecution } from "./claimExecution.js";

describe("claimExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the execution when the claim succeeds", async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "42",
          status: "running",
          worker_token: "test-worker-token",
          locked_until: "2026-10-30T10:05:00.000Z",
        },
      ],
    });

    const result = await claimExecution("42");

    expect(result.status).toBe("running");
    expect(result.id).toBe("42");
    expect(result.worker_token).toBe("test-worker-token");

    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.query.mock.calls[0][1][0]).toBe("42");
    expect(pool.query.mock.calls[0][0]).toContain("locked_until <= NOW()");
  });

  it("returns null when the execution cannot be claimed", async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const result = await claimExecution("42");

    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it("generates a unique worker token for each claim attempt", async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await claimExecution("42");
    await claimExecution("42");

    const firstToken = pool.query.mock.calls[0][1][1];
    const secondToken = pool.query.mock.calls[1][1][1];

    expect(firstToken).not.toBe(secondToken);
  });
});
