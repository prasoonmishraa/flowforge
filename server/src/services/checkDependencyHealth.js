import pool from "../db.js";
import IORedis from "ioredis";
import { checkProcessHealth } from "./checkProcessHealth.js";

export const redis = new IORedis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  lazyConnect: true,
  connectTimeout: 2000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});

async function checkPostgres() {
  try {
    await pool.query("SELECT 1");

    return { status: "up" };
  } catch {
    return { status: "down" };
  }
}

async function checkRedis() {
  try {
    await redis.ping();

    return { status: "up" };
  } catch {
    return { status: "down" };
  }
}

export async function checkDependencyHealth() {
  const [postgres, redisStatus, worker, publisher] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkProcessHealth(redis, "worker").catch(() => ({
      status: "down",
      activeInstances: 0,
    })),
    checkProcessHealth(redis, "publisher").catch(() => ({
      status: "down",
      activeInstances: 0,
    })),
  ]);

  const dependencies = {
    postgres,
    redis: redisStatus,
  };

  const processes = {
    worker,
    publisher,
  };

  const allHealthy = [
    ...Object.values(dependencies),
    ...Object.values(processes),
  ].every((component) => component.status === "up");

  return {
    status: allHealthy ? "ok" : "degraded",
    dependencies,
    processes,
  };
}
