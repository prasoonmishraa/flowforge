import pool from "../db.js";

export async function processExecution(job) {
  const { executionId } = job.data;

  const startResult = await pool.query(
    `UPDATE executions
     SET status = 'running',
         started_at = COALESCE(started_at, NOW())
     WHERE id = $1
       AND status = 'pending'
     RETURNING id`,
    [executionId],
  );

  if (startResult.rowCount === 0) {
    const existingResult = await pool.query(
      `SELECT id, status
       FROM executions
       WHERE id = $1`,
      [executionId],
    );

    if (existingResult.rows.length === 0) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const existingStatus = existingResult.rows[0].status;

    if (existingStatus === "completed" || existingStatus === "failed") {
      return {
        executionId,
        status: existingStatus,
        skipped: true,
      };
    }

    if (existingStatus !== "running") {
      throw new Error(
        `Execution ${executionId} cannot run from status ${existingStatus}`,
      );
    }
  }

  console.log(`Processing execution ${executionId}`);

  // Placeholder for the actual workflow steps.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const completionResult = await pool.query(
    `UPDATE executions
     SET status = 'completed',
         finished_at = NOW()
     WHERE id = $1
       AND status = 'running'
     RETURNING id`,
    [executionId],
  );

  if (completionResult.rowCount === 0) {
    throw new Error(`Execution ${executionId} could not be marked completed`);
  }

  return {
    executionId,
    status: "completed",
  };
}
