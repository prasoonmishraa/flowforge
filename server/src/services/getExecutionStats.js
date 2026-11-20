import pool from "../db.js";

export async function getExecutionStats() {
  const result = await pool.query(
    `SELECT
       COUNT(*)::INTEGER AS "totalExecutions",

       COUNT(*) FILTER (
         WHERE status = 'pending'
       )::INTEGER AS "pendingExecutions",

       COUNT(*) FILTER (
         WHERE status = 'running'
       )::INTEGER AS "runningExecutions",

       COUNT(*) FILTER (
         WHERE status = 'completed'
       )::INTEGER AS "completedExecutions",

       COUNT(*) FILTER (
         WHERE status = 'failed'
       )::INTEGER AS "failedExecutions",

       COALESCE(
         EXTRACT(
           EPOCH FROM NOW() - MIN(created_at) FILTER (
             WHERE status = 'pending'
           )
         ),
         0
       )::INTEGER AS "oldestPendingAgeSeconds",

       COALESCE(
         EXTRACT(
           EPOCH FROM NOW() - MIN(started_at) FILTER (
             WHERE status = 'running'
           )
         ),
         0
       )::INTEGER AS "oldestRunningAgeSeconds"

     FROM executions`,
  );

  return result.rows[0];
}
