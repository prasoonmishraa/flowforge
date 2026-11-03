import { randomUUID } from "node:crypto";
import pool from "../db.js";

export async function claimOutboxEvents(batchSize = 10) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Batch size must be a positive integer");
  }

  const client = await pool.connect();
  const lockToken = randomUUID();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, event_type, aggregate_id, payload
       FROM outbox_events
       WHERE published_at IS NULL
         AND next_attempt_at <= NOW()
         AND (
           locked_until IS NULL
           OR locked_until <= NOW()
         )
       ORDER BY created_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize],
    );

    const events = result.rows;

    if (events.length === 0) {
      await client.query("COMMIT");
      return [];
    }

    const eventIds = events.map((event) => event.id);

    const claimedResult = await client.query(
      `UPDATE outbox_events
       SET lock_token = $2,
           locked_until = NOW() + INTERVAL '60 seconds'
       WHERE id = ANY($1::BIGINT[])
       RETURNING id, event_type, aggregate_id, payload,
                 attempts, lock_token, locked_until`,
      [eventIds, lockToken],
    );

    await client.query("COMMIT");

    return claimedResult.rows;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }

    throw error;
  } finally {
    client.release();
  }
}
