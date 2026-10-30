import pool from "../db.js";

export async function renewExecutionLease(executionId, workerToken) {
  const result = await pool.query(
    `UPDATE executions
     SET locked_until = NOW() + INTERVAL '60 seconds',
         last_heartbeat_at = NOW()
     WHERE id = $1
       AND worker_token = $2
       AND status = 'running'
       AND locked_until > NOW()
     RETURNING id, locked_until, last_heartbeat_at`,
    [executionId, workerToken],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}
