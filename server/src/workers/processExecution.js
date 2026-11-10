import pool from "../db.js";
import { claimExecution } from "./claimExecution.js";
import { renewExecutionLease } from "./renewExecutionLease.js";
import { runWithHeartbeat } from "./runWithHeartbeat.js";
import logger from "../logger.js";

export async function processExecution(job) {
  const { executionId, requestId } = job.data;

  const executionLogger = logger.child({
    service: "flowforge-worker",
    executionId,
    requestId,
  });

  const claim = await claimExecution(executionId);

  if (!claim) {
    return {
      executionId,
      skipped: true,
      reason: "execution_not_claimable",
    };
  }

  const { worker_token: workerToken } = claim;

  try {
    await job.updateData({
      ...job.data,
      workerToken,
    });
  } catch (error) {
    try {
      const releaseResult = await pool.query(
        `UPDATE executions
       SET status = 'pending',
           worker_token = NULL,
           locked_until = NULL,
           last_heartbeat_at = NULL
       WHERE id = $1
         AND status = 'running'
         AND worker_token = $2
       RETURNING id`,
        [executionId, workerToken],
      );

      if (releaseResult.rowCount === 0) {
        executionLogger.warn(
          "Could not release execution: worker ownership was lost",
        );
      }
    } catch (releaseError) {
      error.releaseError = releaseError;

      executionLogger.error(
        { err: releaseError },
        "Failed to release execution",
      );
    }

    throw error;
  }

  executionLogger.info("Execution processing started");

  const renewalResult = await renewExecutionLease(executionId, workerToken);

  if (!renewalResult) {
    throw new Error(`Execution ${executionId} lost its lease`);
  }

  // Placeholder for the actual workflow steps.
  await runWithHeartbeat(executionId, workerToken, async (signal) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);

      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason || new Error("Execution aborted"));
        },
        { once: true },
      );
    });
  });

  const completionResult = await pool.query(
    `UPDATE executions
   SET status = 'completed',
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

  if (completionResult.rowCount === 0) {
    throw new Error(`Execution ${executionId} could not be marked completed`);
  }

  executionLogger.info("Execution processing completed");

  return {
    executionId,
    status: "completed",
  };
}
