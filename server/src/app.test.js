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