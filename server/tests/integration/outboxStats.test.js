import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pool from "../../src/db.js";
import { getOutboxStats } from "../../src/services/getOutboxStats.js";
import request from "supertest";
import app from "../../src/app.js";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

describe("Outbox statistics integration", () => {
  let workflowId;
  let executionId;
  let eventIds = [];

  beforeAll(async () => {
    const workflowResult = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Outbox Stats Integration Workflow"],
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

  it("reports published, delayed, and claimed events", async () => {
    const baseline = await getOutboxStats();

    const publishedEventId = await createEvent();
    const delayedEventId = await createEvent();
    const claimedEventId = await createEvent();

    const lockToken = "00000000-0000-4000-8000-000000000099";

    await pool.query(
      `UPDATE outbox_events
       SET published_at = NOW()
       WHERE id = $1`,
      [publishedEventId],
    );

    await pool.query(
      `UPDATE outbox_events
       SET next_attempt_at = NOW() + INTERVAL '5 minutes'
       WHERE id = $1`,
      [delayedEventId],
    );

    await pool.query(
      `UPDATE outbox_events
       SET lock_token = $2,
           locked_until = NOW() + INTERVAL '60 seconds'
       WHERE id = $1`,
      [claimedEventId, lockToken],
    );

    const stats = await getOutboxStats();

    expect(stats.totalEvents).toBeGreaterThanOrEqual(baseline.totalEvents + 3);

    expect(stats.publishedEvents).toBeGreaterThanOrEqual(
      baseline.publishedEvents + 1,
    );

    expect(stats.pendingEvents).toBeGreaterThanOrEqual(
      baseline.pendingEvents + 2,
    );

    expect(stats.delayedEvents).toBeGreaterThanOrEqual(
      baseline.delayedEvents + 1,
    );

    expect(stats.claimedEvents).toBeGreaterThanOrEqual(
      baseline.claimedEvents + 1,
    );

    expect(Number(stats.totalAttempts)).toBeGreaterThanOrEqual(
      Number(baseline.totalAttempts),
    );

    expect(Number(stats.oldestPendingAgeSeconds)).toBeGreaterThanOrEqual(0);
  });
  it("exposes outbox statistics through the API", async () => {
    const response = await request(app).get("/api/metrics/outbox").expect(200);

    expect(response.body).toHaveProperty("outbox");

    expect(response.body.outbox).toHaveProperty("totalEvents");
    expect(response.body.outbox).toHaveProperty("publishedEvents");
    expect(response.body.outbox).toHaveProperty("pendingEvents");
    expect(response.body.outbox).toHaveProperty("readyEvents");
    expect(response.body.outbox).toHaveProperty("claimedEvents");
    expect(response.body.outbox).toHaveProperty("delayedEvents");
    expect(response.body.outbox).toHaveProperty("expiredLeaseEvents");
    expect(response.body.outbox).toHaveProperty("totalAttempts");
    expect(response.body.outbox).toHaveProperty("oldestPendingAgeSeconds");
  });
});
