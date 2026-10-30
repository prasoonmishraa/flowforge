import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import pool from "../db.js";
import { processExecution } from "./processExecution.js";
import { handleExecutionFailure } from "./handleExecutionFailure.js";

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

worker.on("failed", handleExecutionFailure);

worker.on("error", (error) => {
  console.error("Worker error:", error);
});

console.log("Execution worker started");
