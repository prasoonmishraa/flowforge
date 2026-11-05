import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pool from "../../src/db.js";
import { claimOutboxEvents } from "../../src/workers/claimOutboxEvents.js";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

describe("Outbox event claiming", () => {
  let workflowId;
  let executionId;
  let eventIds = [];

  beforeAll(async () => {
    const workflowResult = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Outbox Claim Integration Workflow"],
    );

    workflowId = workflowResult.rows[0].id;

    const executionResult = await pool.query(
      `INSERT INTO executions (workflow_id, status)
       VALUES ($1, 'pending')
       RETURNING id`,
      [workflowId],
    );

    executionId = executionResult.rows[0].id;
  });

  afterAll(async () => {
    if (eventIds.length > 0) {
      await pool.query(
        "DELETE FROM outbox_events WHERE id = ANY($1::BIGINT[])",
        [eventIds],
      );
    }

    if (executionId !== undefined) {
      await pool.query("DELETE FROM executions WHERE id = $1", [executionId]);
    }

    if (workflowId !== undefined) {
      await pool.query("DELETE FROM workflows WHERE id = $1", [workflowId]);
    }

    await pool.end();
  });

  async function createEvent() {
    const result = await pool.query(
      `INSERT INTO outbox_events (
         event_type,
         aggregate_id,
         payload
       )
       VALUES ($1, $2, $3)
       RETURNING id`,
      ["EXECUTION_REQUESTED", executionId, JSON.stringify({ executionId })],
    );

    const id = result.rows[0].id;
    eventIds.push(id);

    return id;
  }

  it("skips an event locked by another transaction", async () => {
    const firstEventId = await createEvent();
    const secondEventId = await createEvent();

    const lockingClient = await pool.connect();

    try {
      await lockingClient.query("BEGIN");

      await lockingClient.query(
        `SELECT id
         FROM outbox_events
         WHERE id = $1
         FOR UPDATE`,
        [firstEventId],
      );

      const claimedEvents = await claimOutboxEvents(1);

      expect(claimedEvents).toHaveLength(1);
      expect(claimedEvents[0].id).toBe(secondEventId);
    } finally {
      await lockingClient.query("ROLLBACK");
      lockingClient.release();

      // Prevent this test's previously locked event from affecting subsequent tests.
      await pool.query(
        `UPDATE outbox_events
         SET published_at = NOW()
         WHERE id = $1`,
        [firstEventId],
      );
    }
  });

  it("reclaims an event whose publisher lease has expired", async () => {
    const eventId = await createEvent();
    const oldLockToken = "00000000-0000-4000-8000-000000000001";

    await pool.query(
      `UPDATE outbox_events
       SET lock_token = $2,
           locked_until = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [eventId, oldLockToken],
    );

    const claimedEvents = await claimOutboxEvents(1);

    expect(claimedEvents).toHaveLength(1);
    expect(claimedEvents[0].id).toBe(eventId);
    expect(claimedEvents[0].lock_token).not.toBe(oldLockToken);

    expect(new Date(claimedEvents[0].locked_until).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("does not claim an event before its retry time", async () => {
    const eventId = await createEvent();

    await pool.query(
      `UPDATE outbox_events
       SET next_attempt_at = NOW() + INTERVAL '5 minutes'
       WHERE id = $1`,
      [eventId],
    );

    const earlyClaim = await claimOutboxEvents(10);

    expect(earlyClaim.some((event) => event.id === eventId)).toBe(false);

    // Simulate the retry time having arrived without waiting five minutes.
    await pool.query(
      `UPDATE outbox_events
       SET next_attempt_at = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [eventId],
    );

    const eligibleClaim = await claimOutboxEvents(10);

    expect(eligibleClaim.some((event) => event.id === eventId)).toBe(true);
  });
});
