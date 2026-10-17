import { type ConnectionOptions } from "bullmq";

/** Keep BullMQ's private Redis clients consistent with the application's URL. */
export function bullConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("Redis URL must use redis:// or rediss://");
  }
  const database = url.pathname.slice(1);
  if (database && !/^\d+$/.test(database)) {
    throw new Error("Redis URL database must be a non-negative integer");
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database ? Number(database) : undefined,
    // A secure provider URL must never silently become an unencrypted socket.
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    // BullMQ requires this for its blocking worker connections.
    maxRetriesPerRequest: null,
  };
}
