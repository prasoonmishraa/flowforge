import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./claimExecution.js", () => ({
  claimExecution: vi.fn(),
}));

vi.mock("../db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock("./renewExecutionLease.js", () => ({
  renewExecutionLease: vi.fn(),
}));

import pool from "../db.js";
import { claimExecution } from "./claimExecution.js";
import { processExecution } from "./processExecution.js";
import { renewExecutionLease } from "./renewExecutionLease.js";

describe("processExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renewExecutionLease.mockReset();
  });

  it("skips an execution that cannot be claimed", async () => {
    claimExecution.mockResolvedValueOnce(null);

    const job = {
      data: { executionId: "42" },
      updateData: vi.fn(),
    };

    const result = await processExecution(job);

    expect(result).toEqual({
      executionId: "42",
      skipped: true,
      reason: "execution_not_claimable",
    });

    expect(job.updateData).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("processes a successfully claimed execution", async () => {
    claimExecution.mockResolvedValueOnce({
      id: "42",
      worker_token: "worker-token",
    });

    renewExecutionLease.mockResolvedValueOnce({
      id: "42",
    });

    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "42" }],
    });

    const job = {
      data: { executionId: "42" },
      updateData: vi.fn().mockResolvedValue(undefined),
    };

    const result = await processExecution(job);

    expect(result).toEqual({
      executionId: "42",
      status: "completed",
    });

    expect(claimExecution).toHaveBeenCalledWith("42");

    expect(job.updateData).toHaveBeenCalledWith({
      executionId: "42",
      workerToken: "worker-token",
    });

    expect(renewExecutionLease).toHaveBeenCalledWith("42", "worker-token");

    expect(pool.query).toHaveBeenCalledOnce();
  });

  it("throws when completion update affects no rows", async () => {
    claimExecution.mockResolvedValueOnce({
      id: "42",
      worker_token: "worker-token",
    });

    renewExecutionLease.mockResolvedValueOnce({
      id: "42",
    });

    pool.query.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const job = {
      data: { executionId: "42" },
      updateData: vi.fn().mockResolvedValue(undefined),
    };

    await expect(processExecution(job)).rejects.toThrow(
      "Execution 42 could not be marked completed",
    );

    expect(job.updateData).toHaveBeenCalledWith({
      executionId: "42",
      workerToken: "worker-token",
    });
  });

  it("throws when the execution lease is lost", async () => {
    claimExecution.mockResolvedValueOnce({
      id: "42",
      worker_token: "worker-token",
    });

    renewExecutionLease.mockResolvedValueOnce(null);

    const job = {
      data: { executionId: "42" },
      updateData: vi.fn().mockResolvedValue(undefined),
    };

    await expect(processExecution(job)).rejects.toThrow(
      "Execution 42 lost its lease",
    );

    expect(job.updateData).toHaveBeenCalledWith({
      executionId: "42",
      workerToken: "worker-token",
    });

    expect(pool.query).not.toHaveBeenCalled();
  });

  it("releases its claim when persisting the worker token fails", async () => {
    const persistenceError = new Error("Redis unavailable");

    claimExecution.mockResolvedValueOnce({
      id: "42",
      worker_token: "worker-token",
    });

    const job = {
      data: { executionId: "42" },
      updateData: vi.fn().mockRejectedValueOnce(persistenceError),
    };

    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "42" }],
    });

    await expect(processExecution(job)).rejects.toThrow("Redis unavailable");

    expect(pool.query).toHaveBeenCalledOnce();

    const [query, values] = pool.query.mock.calls[0];

    expect(query).toContain("SET status = 'pending'");
    expect(query).toContain("AND worker_token = $2");
    expect(values).toEqual(["42", "worker-token"]);

    expect(renewExecutionLease).not.toHaveBeenCalled();
  });
});
