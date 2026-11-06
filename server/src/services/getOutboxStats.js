import pool from "../db.js";

export async function getOutboxStats() {
  const result = await pool.query(
    `SELECT
       COUNT(*)::INTEGER AS "totalEvents",

       COUNT(*) FILTER (
         WHERE published_at IS NOT NULL
       )::INTEGER AS "publishedEvents",

       COUNT(*) FILTER (
         WHERE published_at IS NULL
       )::INTEGER AS "pendingEvents",

       COUNT(*) FILTER (
         WHERE published_at IS NULL
         AND next_attempt_at <= NOW()
         AND (
           locked_until IS NULL
           OR locked_until <= NOW()
         )
       )::INTEGER AS "readyEvents",

       COUNT(*) FILTER (
         WHERE published_at IS NULL
         AND locked_until > NOW()
       )::INTEGER AS "claimedEvents",

       COUNT(*) FILTER (
         WHERE published_at IS NULL
         AND next_attempt_at > NOW()
       )::INTEGER AS "delayedEvents",

       COUNT(*) FILTER (
         WHERE published_at IS NULL
         AND locked_until <= NOW()
       )::INTEGER AS "expiredLeaseEvents",

       COALESCE(SUM(attempts), 0)::BIGINT AS "totalAttempts",

       COALESCE(
        EXTRACT(
            EPOCH FROM NOW() - (
            MIN(created_at) FILTER (
                WHERE published_at IS NULL
            )
            )
        ),
        0
       )::INTEGER AS "oldestPendingAgeSeconds"

     FROM outbox_events`,
  );

  return result.rows[0];
}
