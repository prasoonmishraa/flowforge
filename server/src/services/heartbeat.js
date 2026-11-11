import { randomUUID } from "node:crypto";
import logger from "../logger.js";

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TTL_SECONDS = 30;

export async function startHeartbeat({
  redis,
  service,
  intervalMs = DEFAULT_INTERVAL_MS,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}) {
  if (!redis) {
    throw new Error("Redis connection is required");
  }

  if (!service) {
    throw new Error("Service name is required");
  }

  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new Error("Heartbeat interval must be a positive integer");
  }

  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error("Heartbeat TTL must be a positive integer");
  }

  const processId = randomUUID();
  const key = `flowforge:health:${service}:${processId}`;
  const heartbeatLogger = logger.child({
    service: `flowforge-${service}`,
    processId,
  });

  let stopped = false;
  let heartbeatInProgress = null;

  async function sendHeartbeat() {
    await redis.set(key, new Date().toISOString(), "EX", ttlSeconds);
  }

  await sendHeartbeat();

  heartbeatLogger.info("Heartbeat started");

  const interval = setInterval(() => {
    if (stopped || heartbeatInProgress) {
      return;
    }

    heartbeatInProgress = sendHeartbeat()
      .catch((error) => {
        heartbeatLogger.error({ err: error }, "Heartbeat update failed");
      })
      .finally(() => {
        heartbeatInProgress = null;
      });
  }, intervalMs);

  interval.unref();

  return {
    key,
    processId,

    async stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      clearInterval(interval);

      if (heartbeatInProgress) {
        await heartbeatInProgress;
      }

      await redis.del(key);

      heartbeatLogger.info("Heartbeat stopped");
    },
  };
}
