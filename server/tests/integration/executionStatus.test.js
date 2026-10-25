import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

describe("Execution status database constraint", () => {
  let workflowId;
  let executionIds = [];

  beforeAll(async () => {
    const result = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Integration Test Workflow"],
    );

    workflowId = result.rows[0].id;
  });

  afterAll(async () => {
    if (executionIds.length > 0) {
      await pool.query("DELETE FROM executions WHERE id = ANY($1::bigint[])", [
        executionIds,
      ]);
    }

    if (workflowId !== undefined) {
      await pool.query("DELETE FROM workflows WHERE id = $1", [workflowId]);
    }

    await pool.end();
  });

  it("rejects an invalid execution status", async () => {
    await expect(
      pool.query(
        `INSERT INTO executions (workflow_id, status)
         VALUES ($1, $2)`,
        [workflowId, "banana"],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });
  it("sets started_at when an execution transitions to running", async () => {
    const result = await pool.query(
      `INSERT INTO executions (workflow_id, status)
     VALUES ($1, $2)
     RETURNING id, status, started_at`,
      [workflowId, "pending"],
    );

    const execution = result.rows[0];
    executionIds.push(execution.id);

    expect(execution.status).toBe("pending");
    expect(execution.started_at).toBeNull();

    const updateResult = await pool.query(
      `UPDATE executions
   SET status = 'running',
       started_at = NOW()
   WHERE id = $1
     AND status = 'pending'
   RETURNING id, status, started_at`,
      [execution.id],
    );

    expect(updateResult.rows).toHaveLength(1);
    expect(updateResult.rows[0].status).toBe("running");
    expect(updateResult.rows[0].started_at).not.toBeNull();
  });
  it.each(["completed", "failed"])(
    "sets finished_at when an execution transitions to %s",
    async (status) => {
      const result = await pool.query(
        `INSERT INTO executions (workflow_id, status, started_at)
       VALUES ($1, 'running', NOW())
       RETURNING id`,
        [workflowId],
      );

      const executionId = result.rows[0].id;
      executionIds.push(executionId);

      const updateResult = await pool.query(
        `UPDATE executions
       SET status = $1, finished_at = NOW()
       WHERE id = $2
         AND status = 'running'
       RETURNING id, status, started_at, finished_at`,
        [status, executionId],
      );

      expect(updateResult.rows).toHaveLength(1);
      expect(updateResult.rows[0].status).toBe(status);
      expect(updateResult.rows[0].started_at).not.toBeNull();
      expect(updateResult.rows[0].finished_at).not.toBeNull();
    },
  );
  it("rejects a transition from completed back to running", async () => {
    const result = await pool.query(
      `INSERT INTO executions (workflow_id, status, started_at, finished_at)
     VALUES ($1, 'completed', NOW() - INTERVAL '1 minute', NOW())
     RETURNING id, status, started_at, finished_at`,
      [workflowId],
    );

    const execution = result.rows[0];
    executionIds.push(execution.id);

    const updateResult = await pool.query(
      `UPDATE executions
     SET status = 'running',
         started_at = NOW(),
         finished_at = NULL
     WHERE id = $1
       AND status = 'running'
     RETURNING id`,
      [execution.id],
    );

    expect(updateResult.rows).toHaveLength(0);

    const storedResult = await pool.query(
      `SELECT status, started_at, finished_at
     FROM executions
     WHERE id = $1`,
      [execution.id],
    );

    expect(storedResult.rows[0].status).toBe("completed");
    expect(storedResult.rows[0].finished_at).not.toBeNull();
  });
});
