import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from "../db.js";
import { handleExecutionFailure } from "./handleExecutionFailure.js";

describe("handleExecutionFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not mark an execution failed when another retry remains", async () => {
    const job = {
      id: "job-42",
      data: {
        executionId: "42",
        workerToken: "worker-token",
      },
      opts: { attempts: 3 },
      attemptsMade: 1,
    };

    await handleExecutionFailure(job, new Error("Temporary failure"));

    expect(pool.query).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalled();
  });

  it("does not update the database when the worker token is missing", async () => {
    const job = {
      id: "job-42",
      data: { executionId: "42" },
      opts: { attempts: 3 },
      attemptsMade: 3,
    };

    await handleExecutionFailure(job, new Error("Final failure"));

    expect(pool.query).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("marks an execution failed when the current worker owns an active lease", async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "42" }],
    });

    const job = {
      id: "job-42",
      data: {
        executionId: "42",
        workerToken: "worker-token",
      },
      opts: { attempts: 3 },
      attemptsMade: 3,
    };

    await handleExecutionFailure(job, new Error("Final failure"));

    expect(pool.query).toHaveBeenCalledOnce();

    const [query, values] = pool.query.mock.calls[0];

    expect(query).toContain("AND worker_token = $2");
    expect(query).toContain("AND locked_until > NOW()");
    expect(query).toContain("worker_token = NULL");
    expect(query).toContain("locked_until = NULL");
    expect(values).toEqual(["42", "worker-token"]);
  });

  it("does not update an execution when the worker no longer owns it", async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const job = {
      id: "job-42",
      data: {
        executionId: "42",
        workerToken: "stale-token",
      },
      opts: { attempts: 3 },
      attemptsMade: 3,
    };

    await handleExecutionFailure(job, new Error("Final failure"));

    expect(pool.query).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalled();
  });

  it("handles database errors without throwing from the event handler", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database unavailable"));

    const job = {
      id: "job-42",
      data: {
        executionId: "42",
        workerToken: "worker-token",
      },
      opts: { attempts: 3 },
      attemptsMade: 3,
    };

    await expect(
      handleExecutionFailure(job, new Error("Final failure")),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });

  it("does nothing when BullMQ provides no job", async () => {
    await handleExecutionFailure(null, new Error("Job unavailable"));

    expect(pool.query).not.toHaveBeenCalled();
  });
});
