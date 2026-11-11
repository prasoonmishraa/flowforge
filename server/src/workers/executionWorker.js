import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import pool from "../db.js";
import { processExecution } from "./processExecution.js";
import { handleExecutionFailure } from "./handleExecutionFailure.js";
import { startHeartbeat } from "../services/heartbeat.js";

const connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  maxRetriesPerRequest: null,
});

const workerHeartbeat = await startHeartbeat({
  redis: connection,
  service: "worker",
});

const worker = new Worker("execution", processExecution, {
  connection,
});

worker.on("completed", (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

worker.on("failed", handleExecutionFailure);

worker.on("error", (error) => {
  console.error("Worker error:", error);
});

console.log("Execution worker started");

let shutdownPromise;

async function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  console.log(`Shutting down execution worker: ${signal}`);

  shutdownPromise = (async () => {
    await worker.close();
    await workerHeartbeat.stop();
    await connection.quit();
    await pool.end();
  })();

  try {
    await shutdownPromise;
    console.log("Execution worker shut down successfully");
  } catch (error) {
    console.error("Execution worker shutdown failed:", error);
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
