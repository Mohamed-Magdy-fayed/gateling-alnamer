import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { getRedis } from "@/server/redis";
import { PostgresRateLimiter } from "./postgres";
import { RedisRateLimiter } from "./redis";

export type RateLimitOptions = { readonly max: number; readonly windowSec: number };
export type RateLimitResult = {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: Date;
};

export interface RateLimiter {
  limit(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
}

export type RateLimiterDeps = {
  readonly redis?: RateLimiter | null;
  readonly postgres?: RateLimiter;
  readonly warn?: (message: string, error: unknown) => void;
};

const WARN_INTERVAL_MS = 60_000;

/** Redis first; per call, a Redis failure falls back to Postgres and warns at most once a minute. */
export function createRateLimiter(deps: RateLimiterDeps = {}): RateLimiter {
  const warn = deps.warn ?? ((message, error) => console.warn(message, error));
  let lastWarnAt = Number.NEGATIVE_INFINITY;

  const redisLimiter = (): RateLimiter | null => {
    if (deps.redis !== undefined) return deps.redis;
    const client = getRedis();
    return client ? new RedisRateLimiter(client) : null;
  };
  const postgresLimiter = (): RateLimiter => deps.postgres ?? new PostgresRateLimiter(db());

  return {
    async limit(key, options) {
      const redis = redisLimiter();
      if (redis) {
        try {
          return await redis.limit(key, options);
        } catch (error) {
          const now = clock.now().getTime();
          if (now - lastWarnAt >= WARN_INTERVAL_MS) {
            lastWarnAt = now;
            warn("Redis rate limiter failed; falling back to Postgres.", error);
          }
        }
      }
      return postgresLimiter().limit(key, options);
    },
  };
}
