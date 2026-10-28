import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import executionQueue from "./queues/executionQueue.js";

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  pool.connect = vi.fn().mockResolvedValue(mockClient);
  executionQueue.add.mockResolvedValue({ id: "test-job-id" });
});

vi.mock("./db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));
vi.mock("./queues/executionQueue.js", () => ({
  default: {
    add: vi.fn(),
  },
}));

import pool from "./db.js";
import app from "./app.js";

describe("GET /api/health", () => {
  it("returns the API health status", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "flowforge-api",
    });
  });
});
describe("POST /api/workflows", () => {
  it("creates a workflow when the input is valid", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "99",
          name: "Test Workflow",
          description: "A workflow created during testing.",
          is_active: true,
          created_at: "2026-10-19T10:00:00.000Z",
        },
      ],
    });

    const response = await request(app).post("/api/workflows").send({
      name: "Test Workflow",
      description: "A workflow created during testing.",
    });

    expect(response.status).toBe(201);
    expect(response.body.workflow).toMatchObject({
      id: "99",
      name: "Test Workflow",
      description: "A workflow created during testing.",
      is_active: true,
    });

    expect(pool.query).toHaveBeenCalledOnce();
  });
  it("rejects an empty workflow name", async () => {
    const response = await request(app)
      .post("/api/workflows")
      .send({ name: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects a request with no workflow name", async () => {
    const response = await request(app).post("/api/workflows").send({
      description: "A workflow without a name.",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/workflows/:id", () => {
  it("updates a workflow when the input is valid", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "1",
          name: "Video Processing v2",
          description: "Processes uploaded videos and generates captions.",
          is_active: true,
          created_at: "2026-10-16T13:21:04.490Z",
        },
      ],
    });

    const response = await request(app)
      .patch("/api/workflows/1")
      .send({ name: "Video Processing v2" });

    expect(response.status).toBe(200);
    expect(response.body.workflow.name).toBe("Video Processing v2");
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it("returns 404 when the workflow does not exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .patch("/api/workflows/999")
      .send({ name: "Updated Workflow" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("WORKFLOW_NOT_FOUND");
  });

  it("rejects an empty update", async () => {
    const response = await request(app).patch("/api/workflows/1").send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });
});
describe("GET /api/workflows/:id", () => {
  it("returns a workflow when it exists", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "1",
          name: "Video Processing",
          description: "Processes uploaded videos and generates captions.",
          is_active: true,
          created_at: "2026-10-16T13:21:04.490Z",
        },
      ],
    });

    const response = await request(app).get("/api/workflows/1");

    expect(response.status).toBe(200);
    expect(response.body.workflow.id).toBe("1");
    expect(response.body.workflow.name).toBe("Video Processing");
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it("returns 404 when the workflow does not exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get("/api/workflows/999");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("WORKFLOW_NOT_FOUND");
  });
});

describe("Workflow ID validation", () => {
  it("rejects a non-numeric ID without querying the database", async () => {
    const response = await request(app).get("/api/workflows/abc");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_WORKFLOW_ID");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects zero as a workflow ID", async () => {
    const response = await request(app).get("/api/workflows/0");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_WORKFLOW_ID");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects an invalid ID in a PATCH request", async () => {
    const response = await request(app)
      .patch("/api/workflows/abc")
      .send({ name: "Updated Workflow" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_WORKFLOW_ID");
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("POST /api/workflows/:id/executions", () => {
  it("creates a pending execution for an active workflow", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: "1", is_active: true }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "10",
            workflow_id: "1",
            status: "pending",
            started_at: null,
            finished_at: null,
            created_at: "2026-10-21T13:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app).post("/api/workflows/1/executions");

    expect(response.status).toBe(201);
    expect(response.body.execution.status).toBe("pending");
    expect(response.body.execution.workflow_id).toBe("1");
    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockClient.release).toHaveBeenCalledOnce();
    expect(executionQueue.add).toHaveBeenCalledWith(
      "process-execution",
      {
        executionId: "10",
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    );
  });

  it("returns 404 when the workflow does not exist", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app).post("/api/workflows/999/executions");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("WORKFLOW_NOT_FOUND");
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("returns 409 when the workflow is inactive", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: "1", is_active: false }],
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app).post("/api/workflows/1/executions");

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("WORKFLOW_INACTIVE");
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("rejects an invalid workflow ID without connecting to the database", async () => {
    const response = await request(app).post("/api/workflows/abc/executions");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_WORKFLOW_ID");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("rolls back and releases the connection when insertion fails", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: "1", is_active: true }],
      })
      .mockRejectedValueOnce(new Error("Database insertion failed"))
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app).post("/api/workflows/1/executions");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("preserves the original error when rollback also fails", async () => {
    const insertionError = new Error("Database insertion failed");

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: "1", is_active: true }],
      })
      .mockRejectedValueOnce(insertionError) // INSERT
      .mockRejectedValueOnce(new Error("Rollback failed"));

    const response = await request(app).post("/api/workflows/1/executions");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(insertionError.rollbackError.message).toBe("Rollback failed");
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("handles a connection acquisition failure", async () => {
    pool.connect.mockRejectedValueOnce(new Error("Database connection failed"));

    const response = await request(app).post("/api/workflows/1/executions");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(mockClient.query).not.toHaveBeenCalled();
    expect(mockClient.release).not.toHaveBeenCalled();
  });

  it("returns 500 when queue submission fails after commit", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: "1", is_active: true }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "10",
            workflow_id: "1",
            status: "pending",
            started_at: null,
            finished_at: null,
            created_at: "2026-10-21T13:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    executionQueue.add.mockRejectedValueOnce(new Error("Redis unavailable"));

    const response = await request(app).post("/api/workflows/1/executions");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(
      mockClient.query.mock.calls.some(([sql]) => sql === "ROLLBACK"),
    ).toBe(false);
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  describe("GET /api/workflows/:id/executions", () => {
    it("returns execution history for an existing workflow", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ id: "1" }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "12",
              workflow_id: "1",
              status: "pending",
              started_at: null,
              finished_at: null,
              created_at: "2026-10-22T10:00:00.000Z",
            },
            {
              id: "11",
              workflow_id: "1",
              status: "completed",
              started_at: "2026-10-22T09:00:00.000Z",
              finished_at: "2026-10-22T09:05:00.000Z",
              created_at: "2026-10-22T09:00:00.000Z",
            },
          ],
        });

      const response = await request(app).get("/api/workflows/1/executions");

      expect(response.status).toBe(200);
      expect(response.body.executions).toHaveLength(2);
      expect(response.body.executions[0].id).toBe("12");
      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockClient.release).toHaveBeenCalledOnce();
    });

    it("returns an empty array when a workflow has no executions", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ id: "1" }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await request(app).get("/api/workflows/1/executions");

      expect(response.status).toBe(200);
      expect(response.body.executions).toEqual([]);
      expect(mockClient.release).toHaveBeenCalledOnce();
    });

    it("returns 404 when the workflow does not exist", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [],
      });

      const response = await request(app).get("/api/workflows/999/executions");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("WORKFLOW_NOT_FOUND");
      expect(mockClient.release).toHaveBeenCalledOnce();
    });

    it("rejects an invalid workflow ID without connecting to the database", async () => {
      const response = await request(app).get("/api/workflows/abc/executions");

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_WORKFLOW_ID");
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it("returns 500 and releases the client when a query fails", async () => {
      mockClient.query.mockRejectedValueOnce(
        new Error("Database query failed"),
      );

      const response = await request(app).get("/api/workflows/1/executions");

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(mockClient.release).toHaveBeenCalledOnce();
    });
  });
});

describe("PATCH /api/executions/:id/status", () => {
  it("transitions a pending execution to running", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "12",
          workflow_id: "1",
          status: "running",
          started_at: "2026-10-23T14:00:00.000Z",
          finished_at: null,
          created_at: "2026-10-23T13:00:00.000Z",
        },
      ],
    });

    const response = await request(app)
      .patch("/api/executions/12/status")
      .send({ status: "running" });

    expect(response.status).toBe(200);
    expect(response.body.execution.status).toBe("running");
    expect(response.body.execution.started_at).not.toBeNull();
    expect(pool.query).toHaveBeenCalledOnce();
  });
  it("rejects an invalid status without querying the database", async () => {
    const response = await request(app)
      .patch("/api/executions/12/status")
      .send({ status: "pending" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });
  it("returns 404 when the execution does not exist", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .patch("/api/executions/999/status")
      .send({ status: "running" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EXECUTION_NOT_FOUND");
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
  it("rejects an invalid status transition", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // UPDATE: no transition occurred
      .mockResolvedValueOnce({
        rows: [{ id: "12", status: "completed" }],
      }); // SELECT: execution exists

    const response = await request(app)
      .patch("/api/executions/12/status")
      .send({ status: "running" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_STATUS_TRANSITION");
    expect(response.body.error.message).toBe(
      "Cannot transition from completed to running",
    );
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
  it("handles a database error", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database update failed"));

    const response = await request(app)
      .patch("/api/executions/12/status")
      .send({ status: "running" });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(pool.query).toHaveBeenCalledOnce();
  });
});
