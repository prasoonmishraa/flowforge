import "dotenv/config";
import pool from "../db.js";
import executionQueue from "../queues/executionQueue.js";
import logger from "../logger.js";
import { publishOutboxBatch } from "./publishOutboxBatch.js";

const PUBLISH_INTERVAL = 3000;
const BATCH_SIZE = 10;

const publisherLogger = logger.child({
  service: "flowforge-outbox-publisher",
});

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
        publisherLogger.info({ ...result }, "Outbox publisher scan completed");
      }
    } catch (error) {
      publisherLogger.error({ err: error }, "Outbox publisher scan failed");
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

publisherLogger.info("Outbox publisher started");

let shutdownPromise;

async function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownRequested = true;
  clearInterval(publisherInterval);

  publisherLogger.info({ signal }, "Shutting down outbox publisher");

  shutdownPromise = (async () => {
    if (activeScan) {
      await activeScan;
    }

    const results = await Promise.allSettled([
      executionQueue.close(),
      pool.end(),
    ]);

    const failures = results.filter((result) => result.status === "rejected");

    if (failures.length > 0) {
      publisherLogger.error(
        { failures },
        "Errors occurred during publisher shutdown",
      );

      process.exitCode = 1;
    } else {
      publisherLogger.info("Outbox publisher shut down successfully");
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

await runPublisherScan();
