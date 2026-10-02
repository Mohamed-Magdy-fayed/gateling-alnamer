import type { Redis } from "@upstash/redis";
import { AppError } from "@/server/errors";
import type { RateLimiter, RateLimitOptions, RateLimitResult } from "./index";

const KEY_PREFIX = "alnamer:rl:";

// Trim, count and add in one atomic step; a denied call adds nothing, so it never consumes capacity.
// No shebang flags: the local REST proxy's Redis 7 rejects `allow-key-locking`.
// KEYS[1] window key; ARGV: now (ms), window (ms), max, unique member.
// Returns { allowed (1|0), count after the call, oldest score (ms) }.
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < max then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, window)
  return { 1, count + 1, now }
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
redis.call('PEXPIRE', key, window)
return { 0, count, tonumber(oldest[2]) }
`;

type ScriptResult = [number, number, number];

/**
 * Sliding-window log in one atomic Lua script (sorted set of request timestamps). `@upstash/ratelimit`
 * is not used for the shebang reason above. Throws when Redis is unreachable; `createRateLimiter`
 * then falls back to Postgres.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async limit(key: string, { max, windowSec }: RateLimitOptions): Promise<RateLimitResult> {
    if (!Number.isInteger(max) || max < 1) {
      throw new AppError("invalid_input", { message: "Rate limit max must be an integer >= 1." });
    }
    if (!Number.isFinite(windowSec) || windowSec <= 0) {
      throw new AppError("invalid_input", { message: "Rate limit windowSec must be > 0." });
    }
    const windowMs = Math.ceil(windowSec * 1000);
    const now = Date.now();
    const member = `${now}:${crypto.randomUUID()}`;

    const [allowed, count, oldest] = await this.redis.eval<string[], ScriptResult>(
      SLIDING_WINDOW_SCRIPT,
      [`${KEY_PREFIX}${key}`],
      [String(now), String(windowMs), String(max), member],
    );
    const resetAt = new Date(Number(oldest) + windowMs);
    if (allowed === 1) return { allowed: true, remaining: max - count, resetAt };
    return { allowed: false, remaining: 0, resetAt };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}${key}`);
  }
}
