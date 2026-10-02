import type { Redis } from "@upstash/redis";
import type { RateLimiter, RateLimitOptions, RateLimitResult } from "./index";

const KEY_PREFIX = "alnamer:rl:";

/**
 * Sliding-window log on plain Redis commands (sorted set of request timestamps). `@upstash/ratelimit`
 * is not used: its Lua scripts carry an `allow-key-locking` shebang flag the local REST proxy's
 * Redis 7 rejects. Throws when Redis is unreachable; `createRateLimiter` then falls back to Postgres.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async limit(key: string, { max, windowSec }: RateLimitOptions): Promise<RateLimitResult> {
    const redisKey = `${KEY_PREFIX}${key}`;
    const windowMs = windowSec * 1000;
    const now = Date.now();
    const member = `${now}:${crypto.randomUUID()}`;

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, now - windowMs);
    pipeline.zadd(redisKey, { score: now, member });
    pipeline.zcard(redisKey);
    pipeline.pexpire(redisKey, windowMs);
    const results = await pipeline.exec<[number, number, number, number]>();
    const count = results[2];

    if (count <= max) {
      return { allowed: true, remaining: max - count, resetAt: new Date(now + windowMs) };
    }

    // Denied requests must not consume capacity.
    await this.redis.zrem(redisKey, member);
    const oldest = await this.redis.zrange<string[]>(redisKey, 0, 0, { withScores: true });
    const oldestScore = Number(oldest[1] ?? now);
    return { allowed: false, remaining: 0, resetAt: new Date(oldestScore + windowMs) };
  }
}
