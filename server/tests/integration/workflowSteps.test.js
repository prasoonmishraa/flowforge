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
  it("deletes a step and cascades its dependency records", async () => {
    const firstStep = await pool.query(
      `INSERT INTO workflow_steps
       (workflow_id, name, step_type, position)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
      [workflowId, "Upload Video", "upload", 101],
    );

    const secondStep = await pool.query(
      `INSERT INTO workflow_steps
       (workflow_id, name, step_type, position)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
      [workflowId, "Compress Video", "compression", 102],
    );

    const thirdStep = await pool.query(
      `INSERT INTO workflow_steps
       (workflow_id, name, step_type, position)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
      [workflowId, "Generate Thumbnail", "thumbnail", 103],
    );

    const firstStepId = firstStep.rows[0].id;
    const secondStepId = secondStep.rows[0].id;
    const thirdStepId = thirdStep.rows[0].id;

    await pool.query(
      `INSERT INTO workflow_step_dependencies
       (workflow_id, step_id, depends_on_step_id)
     VALUES
       ($1, $2, $3),
       ($1, $4, $2)`,
      [workflowId, secondStepId, firstStepId, thirdStepId],
    );

    const response = await request(app).delete(
      `/api/workflows/${workflowId}/steps/${secondStepId}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.step.id).toBe(secondStepId);

    const dependencyResult = await pool.query(
      `SELECT COUNT(*) AS count
     FROM workflow_step_dependencies
     WHERE workflow_id = $1
       AND (
         step_id = $2
         OR depends_on_step_id = $2
       )`,
      [workflowId, secondStepId],
    );

    expect(Number(dependencyResult.rows[0].count)).toBe(0);

    const stepResult = await pool.query(
      `SELECT id
     FROM workflow_steps
     WHERE id = $1 AND workflow_id = $2`,
      [secondStepId, workflowId],
    );

    expect(stepResult.rows).toHaveLength(0);
  });
});
