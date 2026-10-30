import { renewExecutionLease } from "./renewExecutionLease.js";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function runWithHeartbeat(executionId, workerToken, task) {
  const controller = new AbortController();
  let timer;

  let rejectHeartbeat;

  const heartbeatFailure = new Promise((resolve, reject) => {
    rejectHeartbeat = reject;
  });

  const scheduleHeartbeat = () => {
    timer = setTimeout(async () => {
      try {
        const result = await renewExecutionLease(executionId, workerToken);

        if (!result) {
          throw new Error(`Execution ${executionId} lost its lease`);
        }

        scheduleHeartbeat();
      } catch (error) {
        controller.abort(error);
        rejectHeartbeat(error);
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  scheduleHeartbeat();

  try {
    return await Promise.race([task(controller.signal), heartbeatFailure]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
