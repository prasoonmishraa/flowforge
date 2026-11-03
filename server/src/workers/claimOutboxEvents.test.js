import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock("../db.js", () => ({
  default: {
    connect: vi.fn(),
  },
}));

import pool from "../db.js";
import { claimOutboxEvents } from "./claimOutboxEvents.js";

describe("claimOutboxEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.connect.mockResolvedValue(mockClient);
  });

  it("claims and returns a batch of outbox events", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          { id: "1", event_type: "EXECUTION_REQUESTED", aggregate_id: "10" },
          { id: "2", event_type: "EXECUTION_REQUESTED", aggregate_id: "11" },
        ],
      }) // SELECT
      .mockResolvedValueOnce({
        rows: [
          {
            id: "1",
            event_type: "EXECUTION_REQUESTED",
            aggregate_id: "10",
            attempts: 0,
            lock_token: "test-token",
          },
          {
            id: "2",
            event_type: "EXECUTION_REQUESTED",
            aggregate_id: "11",
            attempts: 0,
            lock_token: "test-token",
          },
        ],
      }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await claimOutboxEvents(2);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
    expect(result[1].id).toBe("2");

    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("FOR UPDATE SKIP LOCKED"),
      [2],
    );

    const updateCall = mockClient.query.mock.calls.find(([sql]) =>
      sql.includes("UPDATE outbox_events"),
    );

    expect(updateCall[1][0]).toEqual(["1", "2"]);
    expect(updateCall[1][1]).toBeTruthy();

    expect(result[0].lock_token).toBe(result[1].lock_token);
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("returns an empty array when no events are eligible", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await claimOutboxEvents();

    expect(result).toEqual([]);
    expect(mockClient.query).toHaveBeenCalledTimes(3);
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("rejects an invalid batch size", async () => {
    await expect(claimOutboxEvents(0)).rejects.toThrow(
      "Batch size must be a positive integer",
    );

    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("rolls back when claiming the events fails", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: "1", event_type: "EXECUTION_REQUESTED" }],
      }) // SELECT
      .mockRejectedValueOnce(new Error("Outbox update failed"))
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(claimOutboxEvents()).rejects.toThrow("Outbox update failed");

    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClient.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(
      false,
    );
    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});
