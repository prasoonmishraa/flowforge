import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import pool from "../../src/db.js";
import app from "../../src/app.js";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

describe("Workflow step creation", () => {
  let workflowId;

  beforeAll(async () => {
    const result = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Workflow Steps Integration Test"],
    );

    workflowId = result.rows[0].id;
  });

  afterAll(async () => {
    if (workflowId !== undefined) {
      await pool.query("DELETE FROM workflows WHERE id = $1", [workflowId]);
    }

    await pool.end();
  });

  it("creates a workflow step and persists it in PostgreSQL", async () => {
    const response = await request(app)
      .post(`/api/workflows/${workflowId}/steps`)
      .send({
        name: "Generate Thumbnail",
        step_type: "generate_thumbnail",
        config: {
          format: "jpg",
          width: 1280,
          height: 720,
        },
        position: 1,
      });

    expect(response.status).toBe(201);

    const stepId = response.body.step.id;

    const result = await pool.query(
      `SELECT id, workflow_id, name, step_type, config, position
       FROM workflow_steps
       WHERE id = $1`,
      [stepId],
    );

    expect(result.rows).toHaveLength(1);

    expect(result.rows[0]).toMatchObject({
      id: stepId,
      workflow_id: workflowId,
      name: "Generate Thumbnail",
      step_type: "generate_thumbnail",
      config: {
        format: "jpg",
        width: 1280,
        height: 720,
      },
      position: 1,
    });
  });

  it("rejects a duplicate position in the same workflow", async () => {
    const response = await request(app)
      .post(`/api/workflows/${workflowId}/steps`)
      .send({
        name: "Another Thumbnail Step",
        step_type: "generate_thumbnail",
        position: 1,
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STEP_POSITION_CONFLICT");
  });

  it("returns 404 when the workflow does not exist", async () => {
    const response = await request(app)
      .post("/api/workflows/999999999/steps")
      .send({
        name: "Generate Thumbnail",
        step_type: "generate_thumbnail",
        position: 1,
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("WORKFLOW_NOT_FOUND");
  });
});
