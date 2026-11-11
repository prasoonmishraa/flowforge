export async function checkProcessHealth(redis, service) {
  const pattern = `flowforge:health:${service}:*`;
  let cursor = "0";
  const keys = [];

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );

    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");

  const ttls = await Promise.all(keys.map((key) => redis.ttl(key)));

  const activeInstances = ttls.filter((ttl) => ttl > 0).length;

  return {
    status: activeInstances > 0 ? "up" : "down",
    activeInstances,
  };
}
