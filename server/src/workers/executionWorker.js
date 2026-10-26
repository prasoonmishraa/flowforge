import { Worker } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  "execution",
  async (job) => {
    console.log(`Processing job ${job.id}`);
    console.log("Job data:", job.data);

    return {
      message: `Job ${job.id} processed successfully`,
    };
  },
  { connection },
);

worker.on("completed", (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);
});

worker.on("error", (error) => {
  console.error("Worker error:", error);
});

console.log("Execution worker started");
