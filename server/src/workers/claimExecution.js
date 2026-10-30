import { randomUUID } from "node:crypto";
import pool from "../db.js";

export async function claimExecution(executionId) {
  const workerToken = randomUUID();

  const result = await pool.query(
    `UPDATE executions
     SET status = 'running',
         worker_token = $2,
         locked_until = NOW() + INTERVAL '60 seconds',
         last_heartbeat_at = NOW(),
         started_at = COALESCE(started_at, NOW())
     WHERE id = $1
       AND (
         status = 'pending'
         OR (
           status = 'running'
           AND locked_until <= NOW()
         )
       )
     RETURNING id, status, worker_token, locked_until`,
    [executionId, workerToken],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}
