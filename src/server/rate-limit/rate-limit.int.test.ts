import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { parse } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import * as schema from "@/server/db/schema";
import { createRateLimiter, type RateLimiter, type RateLimitResult } from "./index";
import { PostgresRateLimiter } from "./postgres";
import { RedisRateLimiter } from "./redis";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 5, onnotice: () => {} });
const conn = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

afterEach(() => {
  setClockForTests(null);
});

const unique = (label: string) => `${label}:${crypto.randomUUID()}`;
const T0 = new Date("2030-01-01T00:00:00.000Z");

describe("PostgresRateLimiter", () => {
  const limiter = new PostgresRateLimiter(conn);

  it("blocks after max in a window and allows again in the next window", async () => {
    setClockForTests(T0);
    const key = unique("pg");
    const opts = { max: 3, windowSec: 60 };

    const results: RateLimitResult[] = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.limit(key, opts));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]?.resetAt.toISOString()).toBe("2030-01-01T00:01:00.000Z");

    setClockForTests(new Date("2030-01-01T00:01:00.000Z"));
    const next = await limiter.limit(key, opts);
    expect(next).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("never admits more than max under concurrency and keeps keys independent", async () => {
    setClockForTests(T0);
    const key = unique("pg-concurrent");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => limiter.limit(key, { max: 4, windowSec: 60 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(4);
    const other = await limiter.limit(unique("pg-other"), { max: 4, windowSec: 60 });
    expect(other.allowed).toBe(true);
  });
});

describe("PostgresRateLimiter.reset", () => {
  it("deletes every window of the key and leaves other keys alone", async () => {
    setClockForTests(T0);
    const limiter = new PostgresRateLimiter(conn);
    const key = unique("pg-reset");
    const other = unique("pg-keep");
    await limiter.limit(key, { max: 1, windowSec: 60 });
    await limiter.limit(other, { max: 1, windowSec: 60 });
    expect((await limiter.limit(key, { max: 1, windowSec: 60 })).allowed).toBe(false);

    await limiter.reset(key);
    expect((await limiter.limit(key, { max: 1, windowSec: 60 })).allowed).toBe(true);
    expect((await limiter.limit(other, { max: 1, windowSec: 60 })).allowed).toBe(false);
  });
});

function localRedis(): Redis | null {
  let url = process.env.UPSTASH_REDIS_REST_URL;
  let token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    try {
      const file = parse(readFileSync(".env"));
      url ??= file.UPSTASH_REDIS_REST_URL;
      token ??= file.UPSTASH_REDIS_REST_TOKEN;
    } catch {
      return null;
    }
  }
  if (!url || !token) return null;
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("The Redis int test only runs against a local REST proxy.");
  }
  return new Redis({ url, token });
}

describe("RedisRateLimiter (local REST proxy)", () => {
  const redis = localRedis();

  it.skipIf(!redis)("blocks after max within the window", async () => {
    const limiter = new RedisRateLimiter(redis as Redis);
    const key = unique("redis");
    const results: RateLimitResult[] = [];
    for (let i = 0; i < 3; i++) results.push(await limiter.limit(key, { max: 2, windowSec: 30 }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(results[0]?.remaining).toBe(1);
    expect(results[2]?.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it.skipIf(!redis)("reset clears the window", async () => {
    const limiter = new RedisRateLimiter(redis as Redis);
    const key = unique("redis-reset");
    await limiter.limit(key, { max: 1, windowSec: 30 });
    expect((await limiter.limit(key, { max: 1, windowSec: 30 })).allowed).toBe(false);
    await limiter.reset(key);
    expect((await limiter.limit(key, { max: 1, windowSec: 30 })).allowed).toBe(true);
  });

  it.skipIf(!redis)("lets exactly max through under 20 concurrent calls", async () => {
    const limiter = new RedisRateLimiter(redis as Redis);
    const key = unique("redis-concurrent");
    const results = await Promise.all(
      Array.from({ length: 20 }, () => limiter.limit(key, { max: 5, windowSec: 30 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

describe("RedisRateLimiter validation", () => {
  const limiter = new RedisRateLimiter(new Redis({ url: "http://127.0.0.1:1", token: "x" }));

  it.each([
    [0, 60],
    [-1, 60],
    [1.5, 60],
    [3, 0],
    [3, -5],
    [3, Number.NaN],
  ])("rejects max=%s windowSec=%s before touching Redis", async (max, windowSec) => {
    await expect(limiter.limit("k", { max, windowSec })).rejects.toThrow();
  });
});

describe("createRateLimiter", () => {
  const failing: RateLimiter = {
    limit: () => Promise.reject(new Error("redis down")),
    reset: () => Promise.reject(new Error("redis down")),
  };

  it("falls back to Postgres when Redis throws, warning at most once a minute", async () => {
    setClockForTests(T0);
    const warn = vi.fn();
    const limiter = createRateLimiter({
      redis: failing,
      postgres: new PostgresRateLimiter(conn),
      warn,
    });
    const key = unique("fallback");
    const opts = { max: 1, windowSec: 60 };

    expect((await limiter.limit(key, opts)).allowed).toBe(true);
    expect((await limiter.limit(key, opts)).allowed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    setClockForTests(new Date(T0.getTime() + 61_000));
    await limiter.limit(key, opts);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("uses Postgres directly when Redis is not configured", async () => {
    const warn = vi.fn();
    const limiter = createRateLimiter({
      redis: null,
      postgres: new PostgresRateLimiter(conn),
      warn,
    });
    expect((await limiter.limit(unique("nored"), { max: 1, windowSec: 60 })).allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
