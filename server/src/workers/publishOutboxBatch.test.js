import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./claimOutboxEvents.js", () => ({
  claimOutboxEvents: vi.fn(),
}));

vi.mock("./publishOutboxEvent.js", () => ({
  publishOutboxEvent: vi.fn(),
}));

vi.mock("./handleOutboxPublishFailure.js", () => ({
  handleOutboxPublishFailure: vi.fn(),
}));

import { claimOutboxEvents } from "./claimOutboxEvents.js";
import { publishOutboxEvent } from "./publishOutboxEvent.js";
import { handleOutboxPublishFailure } from "./handleOutboxPublishFailure.js";
import { publishOutboxBatch } from "./publishOutboxBatch.js";

describe("publishOutboxBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes all successfully processed events", async () => {
    claimOutboxEvents.mockResolvedValueOnce([
      { id: "1", lock_token: "token-1" },
      { id: "2", lock_token: "token-1" },
    ]);

    publishOutboxEvent
      .mockResolvedValueOnce({ published: true })
      .mockResolvedValueOnce({ published: true });

    const result = await publishOutboxBatch(10);

    expect(claimOutboxEvents).toHaveBeenCalledWith(10);
    expect(publishOutboxEvent).toHaveBeenCalledTimes(2);

    expect(result).toEqual({
      claimedCount: 2,
      publishedCount: 2,
      retryScheduledCount: 0,
      ownershipLostCount: 0,
      failureHandlingErrorCount: 0,
    });
  });

  it("schedules a retry when publishing fails", async () => {
    const event = { id: "1", lock_token: "token-1" };

    claimOutboxEvents.mockResolvedValueOnce([event]);

    publishOutboxEvent.mockRejectedValueOnce(new Error("Redis unavailable"));

    handleOutboxPublishFailure.mockResolvedValueOnce({
      handled: true,
    });

    const result = await publishOutboxBatch();

    expect(handleOutboxPublishFailure).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ message: "Redis unavailable" }),
    );

    expect(result.retryScheduledCount).toBe(1);
    expect(result.publishedCount).toBe(0);
  });

  it("continues processing after one event fails", async () => {
    const firstEvent = { id: "1", lock_token: "token-1" };
    const secondEvent = { id: "2", lock_token: "token-1" };

    claimOutboxEvents.mockResolvedValueOnce([firstEvent, secondEvent]);

    publishOutboxEvent
      .mockRejectedValueOnce(new Error("Redis unavailable"))
      .mockResolvedValueOnce({ published: true });

    handleOutboxPublishFailure.mockResolvedValueOnce({
      handled: true,
    });

    const result = await publishOutboxBatch();

    expect(publishOutboxEvent).toHaveBeenCalledTimes(2);
    expect(result.retryScheduledCount).toBe(1);
    expect(result.publishedCount).toBe(1);
  });

  it("counts events whose publisher ownership was lost", async () => {
    claimOutboxEvents.mockResolvedValueOnce([
      { id: "1", lock_token: "token-1" },
    ]);

    publishOutboxEvent.mockResolvedValueOnce({
      published: false,
      reason: "publisher_lease_lost",
    });

    const result = await publishOutboxBatch();

    expect(result.ownershipLostCount).toBe(1);
    expect(handleOutboxPublishFailure).not.toHaveBeenCalled();
  });

  it("counts failures to record a publishing failure", async () => {
    claimOutboxEvents.mockResolvedValueOnce([
      { id: "1", lock_token: "token-1" },
    ]);

    publishOutboxEvent.mockRejectedValueOnce(new Error("Redis unavailable"));

    handleOutboxPublishFailure.mockRejectedValueOnce(
      new Error("Database unavailable"),
    );

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const result = await publishOutboxBatch();

      expect(result.failureHandlingErrorCount).toBe(1);
      expect(result.retryScheduledCount).toBe(0);
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("returns an empty summary when no events are available", async () => {
    claimOutboxEvents.mockResolvedValueOnce([]);

    const result = await publishOutboxBatch();

    expect(result).toEqual({
      claimedCount: 0,
      publishedCount: 0,
      retryScheduledCount: 0,
      ownershipLostCount: 0,
      failureHandlingErrorCount: 0,
    });

    expect(publishOutboxEvent).not.toHaveBeenCalled();
  });
});
