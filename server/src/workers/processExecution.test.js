import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from "../db.js";
import { processExecution } from "./processExecution.js";

describe("processExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips an execution that is already completed", async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: "42", status: "completed" }],
      });

    const result = await processExecution({
      data: { executionId: "42" },
    });

    expect(result).toEqual({
      executionId: "42",
      status: "completed",
      skipped: true,
    });

    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("skips an execution that is already failed", async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: "42", status: "failed" }],
      });

    const result = await processExecution({
      data: { executionId: "42" },
    });

    expect(result).toEqual({
      executionId: "42",
      status: "failed",
      skipped: true,
    });

    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("throws when the execution does not exist", async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      processExecution({ data: { executionId: "999" } }),
    ).rejects.toThrow("Execution 999 not found");

    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("processes a pending execution to completion", async () => {
    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: "42" }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: "42" }],
      });

    const result = await processExecution({
      data: { executionId: "42" },
    });

    expect(result).toEqual({
      executionId: "42",
      status: "completed",
    });

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toContain("status = 'running'");
    expect(pool.query.mock.calls[1][0]).toContain("status = 'completed'");
  });

  it("rejects an execution with an unexpected status", async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: "42", status: "unexpected" }],
      });

    await expect(
      processExecution({ data: { executionId: "42" } }),
    ).rejects.toThrow("Execution 42 cannot run from status unexpected");

    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});
