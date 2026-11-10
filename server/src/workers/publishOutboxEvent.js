import pool from "../db.js";
import executionQueue from "../queues/executionQueue.js";
import logger from "../logger.js";

export async function publishOutboxEvent(event) {
  if (event.event_type !== "EXECUTION_REQUESTED") {
    throw new Error(`Unsupported outbox event type: ${event.event_type}`);
  }

  if (!event.lock_token) {
    throw new Error("Outbox event is missing its lock token");
  }

  const executionLogger = logger.child({
    service: "flowforge-outbox-publisher",
    executionId: event.aggregate_id,
    outboxEventId: event.id,
    requestId: event.payload.requestId,
  });

  executionLogger.info("Publishing execution job to Redis");

  await executionQueue.add(
    "process-execution",
    {
      executionId: event.aggregate_id,
      requestId: event.payload.requestId,
    },
    {
      jobId: `execution-${event.aggregate_id}`,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
    },
  );

  const result = await pool.query(
    `UPDATE outbox_events
     SET published_at = NOW(),
         lock_token = NULL,
         locked_until = NULL
     WHERE id = $1
       AND lock_token = $2
       AND published_at IS NULL
       AND locked_until > NOW()
     RETURNING id`,
    [event.id, event.lock_token],
  );

  if (result.rowCount === 0) {
    executionLogger.warn(
      "Publisher lease lost before publication was recorded",
    );

    return {
      published: false,
      reason: "publisher_lease_lost",
    };
  }

  executionLogger.info("Execution job published successfully");

  return {
    published: true,
    eventId: event.id,
    executionId: event.aggregate_id,
  };
}
