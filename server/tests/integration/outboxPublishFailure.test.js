import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pool from "../../src/db.js";
import { handleOutboxPublishFailure } from "../../src/workers/handleOutboxPublishFailure.js";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

describe("Outbox publishing failure recovery", () => {
  let workflowId;
  let executionId;
  let eventId;

  const lockToken = "00000000-0000-4000-8000-000000000002";

  beforeAll(async () => {
    const workflowResult = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Outbox Publish Failure Integration Workflow"],
    );

    workflowId = workflowResult.rows[0].id;

    const executionResult = await pool.query(
      `INSERT INTO executions (workflow_id, status)
       VALUES ($1, 'pending')
       RETURNING id`,
      [workflowId],
    );

    executionId = executionResult.rows[0].id;

    const eventResult = await pool.query(
      `INSERT INTO outbox_events (
         event_type,
         aggregate_id,
         payload,
         lock_token,
         locked_until
       )
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '60 seconds')
       RETURNING id`,
      [
        "EXECUTION_REQUESTED",
        executionId,
        JSON.stringify({ executionId }),
        lockToken,
      ],
    );

    eventId = eventResult.rows[0].id;
  });

  afterAll(async () => {
    if (eventId !== undefined) {
      await pool.query("DELETE FROM outbox_events WHERE id = $1", [eventId]);
    }

    if (executionId !== undefined) {
      await pool.query("DELETE FROM executions WHERE id = $1", [executionId]);
    }

    if (workflowId !== undefined) {
      await pool.query("DELETE FROM workflows WHERE id = $1", [workflowId]);
    }

    await pool.end();
  });

  it("records a publishing failure and schedules an exponential retry", async () => {
    const beforeFailure = Date.now();

    const result = await handleOutboxPublishFailure(
      {
        id: eventId,
        lock_token: lockToken,
      },
      new Error("Redis unavailable"),
    );

    const afterFailure = Date.now();

    expect(result.handled).toBe(true);
    expect(result.attempts).toBe(1);

    const databaseResult = await pool.query(
      `SELECT
         attempts,
         last_error,
         next_attempt_at,
         lock_token,
         locked_until
       FROM outbox_events
       WHERE id = $1`,
      [eventId],
    );

    const event = databaseResult.rows[0];

    expect(event.attempts).toBe(1);
    expect(event.last_error).toBe("Redis unavailable");

    const retryTime = new Date(event.next_attempt_at).getTime();

    expect(retryTime).toBeGreaterThanOrEqual(beforeFailure + 900);
    expect(retryTime).toBeLessThanOrEqual(afterFailure + 1500);
    expect(event.lock_token).toBeNull();
    expect(event.locked_until).toBeNull();
  });
});
