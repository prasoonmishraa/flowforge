import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import pool from "../db.js";

const connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  "execution",
  async (job) => {
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

      if (existingResult.rows[0].status !== "running") {
        throw new Error(
          `Execution ${executionId} cannot run from status ${existingResult.rows[0].status}`,
        );
      }
    }

    console.log(`Processing execution ${executionId}`);
    console.log("Job data:", job.data);

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
  },
  { connection },
);

worker.on("completed", (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

worker.on("failed", async (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);

  if (!job) {
    return;
  }

  const maxAttempts = job.opts.attempts ?? 1;

  if (job.attemptsMade < maxAttempts) {
    console.log(`Execution ${job.data.executionId} will be retried`);
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE executions
       SET status = 'failed',
           finished_at = NOW()
       WHERE id = $1
         AND status = 'running'
       RETURNING id`,
      [job.data.executionId],
    );

    if (result.rowCount === 0) {
      console.error(
        `Could not mark execution ${job.data.executionId} as failed`,
      );
    }
  } catch (dbError) {
    console.error("Failed to update execution status in PostgreSQL:", dbError);
  }
});

worker.on("error", (error) => {
  console.error("Worker error:", error);
});

console.log("Execution worker started");
