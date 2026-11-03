import "dotenv/config";
import IORedis from "ioredis";
import pool from "../db.js";
import executionQueue from "../queues/executionQueue.js";
import { publishOutboxBatch } from "./publishOutboxBatch.js";

const PUBLISH_INTERVAL = 3000;
const BATCH_SIZE = 10;

let scanInProgress = false;
let shutdownRequested = false;
let activeScan = null;

async function runPublisherScan() {
  if (scanInProgress || shutdownRequested) {
    return;
  }

  scanInProgress = true;

  activeScan = (async () => {
    try {
      const result = await publishOutboxBatch(BATCH_SIZE);

      if (result.claimedCount > 0) {
        console.log("Outbox publisher scan:", result);
      }
    } catch (error) {
      console.error("Outbox publisher scan failed:", error);
    }
  })();

  try {
    await activeScan;
  } finally {
    activeScan = null;
    scanInProgress = false;
  }
}

const publisherInterval = setInterval(runPublisherScan, PUBLISH_INTERVAL);

console.log("Outbox publisher started");

let shutdownPromise;

async function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownRequested = true;
  clearInterval(publisherInterval);

  console.log(`${signal} received. Shutting down outbox publisher...`);

  shutdownPromise = (async () => {
    // Allow an active publishing scan to finish.
    if (activeScan) {
      await activeScan;
    }

    // Close Redis and PostgreSQL connections.
    const results = await Promise.allSettled([
      executionQueue.close(),
      pool.end(),
    ]);

    const failures = results.filter((result) => result.status === "rejected");

    if (failures.length > 0) {
      console.error("Errors occurred during publisher shutdown:", failures);
      process.exitCode = 1;
    } else {
      console.log("Outbox publisher shut down successfully");
    }
  })();

  return shutdownPromise;
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

// Process existing events immediately instead of waiting 3 seconds.
await runPublisherScan();
