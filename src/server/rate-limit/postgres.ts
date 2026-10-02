import { and, eq, lt, sql } from "drizzle-orm";
import { clock } from "@/server/clock";
import type { DbExecutor } from "@/server/db";
import { rateLimitCounters } from "@/server/db/schema";
import type { RateLimiter, RateLimitOptions, RateLimitResult } from "./index";

/** Fixed-window limiter; the upsert increment is atomic, so concurrent calls never over-admit. */
export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly executor: DbExecutor) {}

  async limit(key: string, { max, windowSec }: RateLimitOptions): Promise<RateLimitResult> {
    const windowMs = windowSec * 1000;
    const startMs = Math.floor(clock.now().getTime() / windowMs) * windowMs;
    const windowStart = new Date(startMs);

    const [row] = await this.executor
      .insert(rateLimitCounters)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitCounters.key, rateLimitCounters.windowStart],
        set: { count: sql`${rateLimitCounters.count} + 1` },
      })
      .returning({ count: rateLimitCounters.count });
    const count = row?.count ?? max + 1;

    // Opportunistic cleanup of this key's finished windows.
    await this.executor
      .delete(rateLimitCounters)
      .where(and(eq(rateLimitCounters.key, key), lt(rateLimitCounters.windowStart, windowStart)));

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetAt: new Date(startMs + windowMs),
    };
  }

  async reset(key: string): Promise<void> {
    await this.executor.delete(rateLimitCounters).where(eq(rateLimitCounters.key, key));
  }
}
