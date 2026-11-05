import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pool from "../../src/db.js";
import executionQueue from "../../src/queues/executionQueue.js";
import { claimOutboxEvents } from "../../src/workers/claimOutboxEvents.js";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

describe("Outbox publisher crash recovery", () => {
  let workflowId;
  let executionId;
  let eventId;
  let firstClaim;
  let secondClaim;
  let jobId;

  beforeAll(async () => {
    const workflowResult = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Outbox Crash Recovery Integration Workflow"],
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
         payload
       )
       VALUES ($1, $2, $3)
       RETURNING id`,
      ["EXECUTION_REQUESTED", executionId, JSON.stringify({ executionId })],
    );

    eventId = eventResult.rows[0].id;
    jobId = `execution-${executionId}`;
  });

  afterAll(async () => {
    if (jobId) {
      const job = await executionQueue.getJob(jobId);

      if (job) {
        await job.remove();
      }
    }

    const claimedIds = [
      ...(firstClaim || []).map((event) => event.id),
      ...(secondClaim || []).map((event) => event.id),
    ];

    const uniqueClaimedIds = [...new Set(claimedIds)];

    if (uniqueClaimedIds.length > 0) {
      await pool.query(
        `UPDATE outbox_events
         SET lock_token = NULL,
             locked_until = NULL
         WHERE id = ANY($1::BIGINT[])
           AND published_at IS NULL`,
        [uniqueClaimedIds],
      );
    }

    if (eventId !== undefined) {
      await pool.query("DELETE FROM outbox_events WHERE id = $1", [eventId]);
    }

    if (executionId !== undefined) {
      await pool.query("DELETE FROM executions WHERE id = $1", [executionId]);
    }

    if (workflowId !== undefined) {
      await pool.query("DELETE FROM workflows WHERE id = $1", [workflowId]);
    }

    await executionQueue.close();
    await pool.end();
  });

  it("deduplicates a job when a publisher crashes after Redis accepts it", async () => {
    firstClaim = await claimOutboxEvents(1000);

    const firstEvent = firstClaim.find((event) => event.id === eventId);

    expect(firstEvent).toBeDefined();

    await executionQueue.add(
      "process-execution",
      { executionId },
      {
        jobId,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    );

    const firstStoredJob = await executionQueue.getJob(jobId);

    expect(firstStoredJob).toBeDefined();
    expect(firstStoredJob.id).toBe(jobId);

    const unpublishedEvent = await pool.query(
      `SELECT published_at
       FROM outbox_events
       WHERE id = $1`,
      [eventId],
    );

    expect(unpublishedEvent.rows[0].published_at).toBeNull();

    await pool.query(
      `UPDATE outbox_events
       SET locked_until = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [eventId],
    );

    secondClaim = await claimOutboxEvents(1000);

    const reclaimedEvent = secondClaim.find((event) => event.id === eventId);

    expect(reclaimedEvent).toBeDefined();
    expect(reclaimedEvent.lock_token).not.toBe(firstEvent.lock_token);

    const secondJob = await executionQueue.add(
      "process-execution",
      { executionId },
      {
        jobId,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    );

    const storedJob = await executionQueue.getJob(jobId);

    expect(secondJob.id).toBe(firstStoredJob.id);
    expect(storedJob.id).toBe(firstStoredJob.id);
    expect(storedJob.data).toEqual({ executionId });
  });
});
