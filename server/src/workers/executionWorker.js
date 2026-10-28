import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import pool from "../db.js";
import { processExecution } from "./processExecution.js";

const connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  maxRetriesPerRequest: null,
});

const worker = new Worker("execution", processExecution, {
  connection,
});

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
