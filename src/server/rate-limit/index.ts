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
  /** Forgets every recorded hit for the key (a successful sign-in clears its failure counter). */
  reset(key: string): Promise<void>;
}

export type RateLimiterDeps = {
  readonly redis?: RateLimiter | null;
  readonly postgres?: RateLimiter;
  readonly warn?: (message: string, error: unknown) => void;
};

const WARN_INTERVAL_MS = 60_000;

/** Stable tag so log drains and Sentry (O-phase) can alert on it. */
export const DEGRADED_ALERT_TAG = "[alert] rate_limiter_degraded";

/**
 * Redis first; per call, a Redis failure falls back to Postgres and logs `[alert] rate_limiter_degraded`
 * at most once a minute (`warn` is injectable for tests).
 */
export function createRateLimiter(deps: RateLimiterDeps = {}): RateLimiter {
  const warn =
    deps.warn ??
    ((message, error) =>
      console.error(DEGRADED_ALERT_TAG, message, error instanceof Error ? error.message : error));
  let lastWarnAt = Number.NEGATIVE_INFINITY;

  const warnOnce = (message: string, error: unknown): void => {
    const now = clock.now().getTime();
    if (now - lastWarnAt < WARN_INTERVAL_MS) return;
    lastWarnAt = now;
    warn(message, error);
  };

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
          warnOnce("Redis rate limiter failed; falling back to Postgres.", error);
        }
      }
      return postgresLimiter().limit(key, options);
    },

    /** Clears both backends: hits may sit in either one, depending on when Redis was down. */
    async reset(key) {
      const redis = redisLimiter();
      if (redis) {
        try {
          await redis.reset(key);
        } catch (error) {
          warnOnce("Redis rate limiter reset failed; clearing Postgres only.", error);
        }
      }
      await postgresLimiter().reset(key);
    },
  };
}
