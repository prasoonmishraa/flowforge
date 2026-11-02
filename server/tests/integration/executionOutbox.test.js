import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";

import pool from "../../src/db.js";
import app from "../../src/app.js";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

describe("Execution creation with transactional outbox", () => {
  let workflowId;

  beforeAll(async () => {
    const result = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Outbox Integration Test Workflow"],
    );

    workflowId = result.rows[0].id;
  });

  afterAll(async () => {
    if (workflowId !== undefined) {
      await pool.query(
        `DELETE FROM outbox_events
         WHERE aggregate_id IN (
           SELECT id FROM executions WHERE workflow_id = $1
         )`,
        [workflowId],
      );

      await pool.query(
        "DELETE FROM executions WHERE workflow_id = $1",
        [workflowId],
      );

      await pool.query(
        "DELETE FROM workflows WHERE id = $1",
        [workflowId],
      );
    }

    await pool.end();
  });

  it("creates an execution and its outbox event together", async () => {
    const response = await request(app).post(
      `/api/workflows/${workflowId}/executions`,
    );

    expect(response.status).toBe(201);
    expect(response.body.execution.status).toBe("pending");

    const executionId = response.body.execution.id;

    const result = await pool.query(
      `SELECT
         e.id AS execution_id,
         e.status,
         o.event_type,
         o.aggregate_id,
         o.payload
       FROM executions e
       JOIN outbox_events o
         ON o.aggregate_id = e.id
       WHERE e.id = $1`,
      [executionId],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe("pending");
    expect(result.rows[0].event_type).toBe("EXECUTION_REQUESTED");
    expect(result.rows[0].aggregate_id).toBe(executionId);
    expect(result.rows[0].payload).toEqual({
      executionId,
    });
  });
});
