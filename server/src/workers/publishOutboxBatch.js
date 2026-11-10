import { claimOutboxEvents } from "./claimOutboxEvents.js";
import { publishOutboxEvent } from "./publishOutboxEvent.js";
import { handleOutboxPublishFailure } from "./handleOutboxPublishFailure.js";
import logger from "../logger.js";

export async function publishOutboxBatch(batchSize = 10) {
  const events = await claimOutboxEvents(batchSize);

  const summary = {
    claimedCount: events.length,
    publishedCount: 0,
    retryScheduledCount: 0,
    ownershipLostCount: 0,
    failureHandlingErrorCount: 0,
  };

  for (const event of events) {
    const eventLogger = logger.child({
      service: "flowforge-outbox-publisher",
      executionId: event.aggregate_id,
      outboxEventId: event.id,
      requestId: event.payload?.requestId,
    });

    try {
      const result = await publishOutboxEvent(event);

      if (result.published) {
        summary.publishedCount += 1;
      } else {
        summary.ownershipLostCount += 1;
      }
    } catch (error) {
      try {
        const failureResult = await handleOutboxPublishFailure(event, error);

        if (failureResult.handled) {
          summary.retryScheduledCount += 1;

          eventLogger.warn(
            { err: error, attempts: failureResult.attempts },
            "Outbox event publishing failed; retry scheduled",
          );
        } else {
          summary.ownershipLostCount += 1;
        }
      } catch (handlingError) {
        summary.failureHandlingErrorCount += 1;

        eventLogger.error(
          { err: handlingError, publishError: error },
          "Failed to record outbox publishing failure",
        );
      }
    }
  }

  return summary;
}
