import pool from "../db.js";

export async function handleOutboxPublishFailure(event, error) {
  const result = await pool.query(
    `UPDATE outbox_events
     SET attempts = attempts + 1,
         last_error = $3,
         next_attempt_at = NOW() + (
           LEAST(300, POWER(2, attempts)) * INTERVAL '1 second'
         ),
         lock_token = NULL,
         locked_until = NULL
     WHERE id = $1
       AND lock_token = $2
       AND published_at IS NULL
       AND locked_until > NOW()
     RETURNING id, attempts, next_attempt_at`,
    [event.id, event.lock_token, error.message],
  );

  if (result.rowCount === 0) {
    return {
      handled: false,
      reason: "publisher_lease_lost",
    };
  }

  return {
    handled: true,
    eventId: event.id,
    attempts: result.rows[0].attempts,
    nextAttemptAt: result.rows[0].next_attempt_at,
  };
}
