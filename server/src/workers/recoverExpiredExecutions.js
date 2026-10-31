import executionQueue from "../queues/executionQueue.js";
import { findExpiredExecutions } from "./findExpiredExecutions.js";

export async function recoverExpiredExecutions() {
  const expiredExecutions = await findExpiredExecutions();

  let enqueuedCount = 0;

  for (const execution of expiredExecutions) {
    const leaseTimestamp = new Date(execution.locked_until).getTime();

    await executionQueue.add(
      "process-execution",
      {
        executionId: execution.id,
      },
      {
        jobId: `recovery-${execution.id}-${leaseTimestamp}`,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    enqueuedCount += 1;
  }

  return {
    scannedCount: expiredExecutions.length,
    enqueuedCount,
  };
}
