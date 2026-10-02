import "server-only";
import { Redis } from "@upstash/redis";
import { serverEnv } from "@/server/env";

const globalForRedis = globalThis as unknown as { alnamerRedis?: Redis | null };

/** Lazy Upstash REST client; `null` when the URL and token are not both configured (demo). */
export function getRedis(): Redis | null {
  if (globalForRedis.alnamerRedis === undefined) {
    const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = serverEnv();
    globalForRedis.alnamerRedis = url && token ? new Redis({ url, token }) : null;
  }
  return globalForRedis.alnamerRedis;
}
