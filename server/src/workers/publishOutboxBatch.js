import { claimOutboxEvents } from "./claimOutboxEvents.js";
import { publishOutboxEvent } from "./publishOutboxEvent.js";
import { handleOutboxPublishFailure } from "./handleOutboxPublishFailure.js";

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
        } else {
          summary.ownershipLostCount += 1;
        }
      } catch (handlingError) {
        summary.failureHandlingErrorCount += 1;

        console.error(
          `Failed to record publishing failure for outbox event ${event.id}:`,
          handlingError,
        );
      }
    }
  }

  return summary;
}
