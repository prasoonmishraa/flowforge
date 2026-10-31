import "dotenv/config";

import pool from "../db.js";
import executionQueue from "../queues/executionQueue.js";
import { recoverExpiredExecutions } from "./recoverExpiredExecutions.js";
import { createRecoveryScheduler } from "./createRecoveryScheduler.js";

const scheduler = createRecoveryScheduler({
  recoverExpiredExecutions,
  intervalMs: 30_000,
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(`[Recovery] Received ${signal}. Shutting down...`);

  try {
    await scheduler.stop();

    const results = await Promise.allSettled([
      executionQueue.close(),
      pool.end(),
    ]);

    const failures = results.filter((result) => result.status === "rejected");

    if (failures.length > 0) {
      for (const failure of failures) {
        console.error("[Recovery] Resource cleanup failed:", failure.reason);
      }

      process.exitCode = 1;
      return;
    }

    console.log("[Recovery] Shutdown complete");
  } catch (error) {
    console.error("[Recovery] Shutdown failed:", error);
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await scheduler.start();
