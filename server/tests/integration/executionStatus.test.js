import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.test" });

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
});
