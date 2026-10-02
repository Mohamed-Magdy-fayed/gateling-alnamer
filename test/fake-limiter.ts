import { clock } from "@/server/clock";
import type { RateLimiter, RateLimitOptions, RateLimitResult } from "@/server/rate-limit";

/** In-memory sliding-window limiter on the injectable clock; records every key it sees. */
export class MemoryLimiter implements RateLimiter {
  readonly hits = new Map<string, number[]>();
  readonly keys = new Set<string>();
  readonly resets: string[] = [];

  async limit(key: string, { max, windowSec }: RateLimitOptions): Promise<RateLimitResult> {
    this.keys.add(key);
    const now = clock.now().getTime();
    const windowMs = windowSec * 1000;
    const live = (this.hits.get(key) ?? []).filter((at) => at > now - windowMs);
    const oldest = live[0] ?? now;
    if (live.length >= max) {
      this.hits.set(key, live);
      return { allowed: false, remaining: 0, resetAt: new Date(oldest + windowMs) };
    }
    live.push(now);
    this.hits.set(key, live);
    return {
      allowed: true,
      remaining: max - live.length,
      resetAt: new Date((live[0] ?? now) + windowMs),
    };
  }

  async reset(key: string): Promise<void> {
    this.resets.push(key);
    this.hits.delete(key);
  }
}
