import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import pool from "../../src/db.js";
import { getExecutionStats } from "../../src/services/getExecutionStats.js";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

describe("Execution statistics integration", () => {
  let workflowId;
  let executionIds = [];
  let baseline;

  beforeAll(async () => {
    baseline = await getExecutionStats();

    const workflowResult = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Execution Stats Integration Workflow"],
    );

    workflowId = workflowResult.rows[0].id;

    const executionResult = await pool.query(
      `INSERT INTO executions (
         workflow_id,
         status,
         created_at,
         started_at,
         finished_at
       )
       VALUES
         ($1, 'pending', NOW() - INTERVAL '2 minutes', NULL, NULL),
         ($1, 'running', NOW() - INTERVAL '5 minutes',
          NOW() - INTERVAL '3 minutes', NULL),
         ($1, 'completed', NOW(), NOW(), NOW()),
         ($1, 'failed', NOW(), NOW(), NOW())
       RETURNING id`,
      [workflowId],
    );

    executionIds = executionResult.rows.map((row) => row.id);
  });

  afterAll(async () => {
    if (executionIds.length > 0) {
      await pool.query("DELETE FROM executions WHERE id = ANY($1::BIGINT[])", [
        executionIds,
      ]);
    }

    if (workflowId !== undefined) {
      await pool.query("DELETE FROM workflows WHERE id = $1", [workflowId]);
    }

    await pool.end();
  });

  it("reports execution counts and oldest execution ages", async () => {
    const stats = await getExecutionStats();

    expect(stats.totalExecutions).toBe(baseline.totalExecutions + 4);
    expect(stats.pendingExecutions).toBe(baseline.pendingExecutions + 1);
    expect(stats.runningExecutions).toBe(baseline.runningExecutions + 1);
    expect(stats.completedExecutions).toBe(baseline.completedExecutions + 1);
    expect(stats.failedExecutions).toBe(baseline.failedExecutions + 1);

    expect(stats.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(120);
    expect(stats.oldestRunningAgeSeconds).toBeGreaterThanOrEqual(180);
  });

  it("exposes execution statistics through the API", async () => {
    const response = await request(app)
      .get("/api/metrics/executions")
      .expect(200);

    expect(response.body).toHaveProperty("executions");

    expect(response.body.executions).toHaveProperty("totalExecutions");
    expect(response.body.executions).toHaveProperty("pendingExecutions");
    expect(response.body.executions).toHaveProperty("runningExecutions");
    expect(response.body.executions).toHaveProperty("completedExecutions");
    expect(response.body.executions).toHaveProperty("failedExecutions");
    expect(response.body.executions).toHaveProperty("oldestPendingAgeSeconds");
    expect(response.body.executions).toHaveProperty("oldestRunningAgeSeconds");
  });
});
