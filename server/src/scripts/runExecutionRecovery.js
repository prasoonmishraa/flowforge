import "dotenv/config";

import pool from "../db.js";
import executionQueue from "../queues/executionQueue.js";
import { recoverExpiredExecutions } from "../workers/recoverExpiredExecutions.js";

try {
  const result = await recoverExpiredExecutions();

  console.log("Execution recovery scan completed");
  console.log(`Expired executions found: ${result.scannedCount}`);
  console.log(`Recovery jobs submitted: ${result.enqueuedCount}`);
} catch (error) {
  console.error("Execution recovery failed:", error);
  process.exitCode = 1;
} finally {
  await executionQueue.close();
  await pool.end();
}
