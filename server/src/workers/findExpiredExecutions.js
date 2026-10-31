import pool from "../db.js";

export async function findExpiredExecutions() {
  const result = await pool.query(
    `SELECT id, workflow_id, status, worker_token, locked_until
     FROM executions
     WHERE status = 'running'
       AND locked_until <= NOW()
     ORDER BY locked_until ASC`,
  );

  return result.rows;
}
