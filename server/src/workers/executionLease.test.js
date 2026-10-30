import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pool from "../../src/db.js";
import { claimExecution } from "../../src/workers/claimExecution.js";
import { renewExecutionLease } from "../../src/workers/renewExecutionLease.js";
import { handleExecutionFailure } from "../../src/workers/handleExecutionFailure.js";

if (process.env.DB_NAME !== "flowforge_test") {
  throw new Error(
    `Integration tests must use flowforge_test, not ${process.env.DB_NAME}`,
  );
}

describe("Execution lease integration", () => {
  let workflowId;
  const executionIds = [];

  async function createPendingExecution() {
    const result = await pool.query(
      `INSERT INTO executions (workflow_id, status)
       VALUES ($1, 'pending')
       RETURNING id`,
      [workflowId],
    );

    const executionId = result.rows[0].id;
    executionIds.push(executionId);

    return executionId;
  }

  beforeAll(async () => {
    const result = await pool.query(
      `INSERT INTO workflows (name)
       VALUES ($1)
       RETURNING id`,
      ["Execution Lease Integration Test"],
    );

    workflowId = result.rows[0].id;
  });

  afterAll(async () => {
    if (executionIds.length > 0) {
      await pool.query("DELETE FROM executions WHERE id = ANY($1::bigint[])", [
        executionIds,
      ]);
    }

    if (workflowId !== undefined) {
      await pool.query("DELETE FROM workflows WHERE id = $1", [workflowId]);
    }
  });

  it("allows only one worker to claim an execution", async () => {
    const executionId = await createPendingExecution();

    const results = await Promise.all([
      claimExecution(executionId),
      claimExecution(executionId),
    ]);

    const successfulClaims = results.filter((result) => result !== null);

    expect(successfulClaims).toHaveLength(1);
  });

  it("allows the current owner to renew its lease", async () => {
    const executionId = await createPendingExecution();
    const claim = await claimExecution(executionId);

    const result = await renewExecutionLease(executionId, claim.worker_token);

    expect(result).not.toBeNull();
    expect(result.id).toBe(executionId);
  });

  it("rejects renewal from a stale worker", async () => {
    const executionId = await createPendingExecution();
    const claim = await claimExecution(executionId);

    const result = await renewExecutionLease(
      executionId,
      "00000000-0000-0000-0000-000000000001",
    );

    expect(result).toBeNull();
    expect(claim).not.toBeNull();
  });

  it("allows a new worker to claim an expired lease", async () => {
    const executionId = await createPendingExecution();
    const firstClaim = await claimExecution(executionId);

    await pool.query(
      `UPDATE executions
       SET locked_until = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [executionId],
    );

    const secondClaim = await claimExecution(executionId);

    expect(secondClaim).not.toBeNull();
    expect(secondClaim.worker_token).not.toBe(firstClaim.worker_token);
  });
  it("prevents a stale worker from marking a reclaimed execution as failed", async () => {
    const executionId = await createPendingExecution();

    const firstClaim = await claimExecution(executionId);

    // Expire the first worker's lease.
    await pool.query(
      `UPDATE executions
     SET locked_until = NOW() - INTERVAL '1 second'
     WHERE id = $1`,
      [executionId],
    );

    // A second worker reclaims the execution.
    const secondClaim = await claimExecution(executionId);

    expect(secondClaim).not.toBeNull();
    expect(secondClaim.worker_token).not.toBe(firstClaim.worker_token);

    // Simulate the first worker's final BullMQ failure event.
    const staleJob = {
      id: "stale-job",
      data: {
        executionId,
        workerToken: firstClaim.worker_token,
      },
      opts: { attempts: 3 },
      attemptsMade: 3,
    };

    await handleExecutionFailure(staleJob, new Error("Old worker failed"));

    const storedResult = await pool.query(
      `SELECT status, worker_token
     FROM executions
     WHERE id = $1`,
      [executionId],
    );

    expect(storedResult.rows[0].status).toBe("running");
    expect(storedResult.rows[0].worker_token).toBe(secondClaim.worker_token);
  });
  it("prevents an expired lease owner from marking an execution as failed", async () => {
    const executionId = await createPendingExecution();
    const claim = await claimExecution(executionId);

    await pool.query(
      `UPDATE executions
     SET locked_until = NOW() - INTERVAL '1 second'
     WHERE id = $1`,
      [executionId],
    );

    const expiredJob = {
      id: "expired-job",
      data: {
        executionId,
        workerToken: claim.worker_token,
      },
      opts: { attempts: 3 },
      attemptsMade: 3,
    };

    await handleExecutionFailure(expiredJob, new Error("Worker lease expired"));

    const storedResult = await pool.query(
      `SELECT status, worker_token, locked_until
     FROM executions
     WHERE id = $1`,
      [executionId],
    );

    expect(storedResult.rows[0].status).toBe("running");
    expect(storedResult.rows[0].worker_token).toBe(claim.worker_token);
    expect(new Date(storedResult.rows[0].locked_until).getTime()).toBeLessThan(
      Date.now(),
    );
  });
});
