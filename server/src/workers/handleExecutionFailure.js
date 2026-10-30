import pool from "../db.js";

export async function handleExecutionFailure(job, error) {
  console.error(`Job ${job?.id} failed:`, error.message);

  if (!job) {
    return;
  }

  const maxAttempts = job.opts.attempts ?? 1;

  if (job.attemptsMade < maxAttempts) {
    console.log(`Execution ${job.data.executionId} will be retried`);
    return;
  }

  const { executionId, workerToken } = job.data;

  if (!workerToken) {
    console.error(
      `Cannot mark execution ${executionId} as failed: worker token is missing`,
    );
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE executions
       SET status = 'failed',
           finished_at = NOW(),
           worker_token = NULL,
           locked_until = NULL,
           last_heartbeat_at = NULL
       WHERE id = $1
         AND status = 'running'
         AND worker_token = $2
         AND locked_until > NOW()
       RETURNING id`,
      [executionId, workerToken],
    );

    if (result.rowCount === 0) {
      console.error(
        `Execution ${executionId} was not marked failed: worker ownership was lost or its lease expired`,
      );
    }
  } catch (dbError) {
    console.error("Failed to update execution status in PostgreSQL:", dbError);
  }
}
