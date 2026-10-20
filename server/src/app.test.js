import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("./db.js", () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from "./db.js";
import app from "./app.js";

beforeEach(() => {
  vi.clearAllMocks();
});

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

    const response = await request(app)
      .post("/api/workflows")
      .send({
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
    const response = await request(app)
      .post("/api/workflows")
      .send({
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
    const response = await request(app)
      .patch("/api/workflows/1")
      .send({});

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
