import { afterEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { MemoryLimiter } from "../../../test/fake-limiter";
import { FakeRedis } from "../../../test/fake-redis";
import { createRateLimiter, type RateLimiter } from "./index";
import { RedisRateLimiter } from "./redis";

const T0 = new Date("2030-01-01T00:00:00.000Z");
const failing: RateLimiter = {
  limit: () => Promise.reject(new Error("redis down")),
  reset: () => Promise.reject(new Error("redis down")),
};

afterEach(() => {
  setClockForTests(null);
  vi.restoreAllMocks();
});

describe("degraded alert", () => {
  it("logs the stable [alert] rate_limiter_degraded line at most once a minute", async () => {
    setClockForTests(T0);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const limiter = createRateLimiter({ redis: failing, postgres: new MemoryLimiter() });

    await limiter.limit("k", { max: 5, windowSec: 60 });
    await limiter.limit("k", { max: 5, windowSec: 60 });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe("[alert] rate_limiter_degraded");

    setClockForTests(new Date(T0.getTime() + 61_000));
    await limiter.limit("k", { max: 5, windowSec: 60 });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("still limits through the Postgres fallback while degraded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const limiter = createRateLimiter({ redis: failing, postgres: new MemoryLimiter() });
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await limiter.limit("k", { max: 2, windowSec: 60 }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
  });
});

describe("reset", () => {
  it("clears the key in Postgres even when Redis is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const postgres = new MemoryLimiter();
    const limiter = createRateLimiter({ redis: failing, postgres });
    await limiter.limit("k", { max: 1, windowSec: 60 });
    expect((await limiter.limit("k", { max: 1, windowSec: 60 })).allowed).toBe(false);
    await limiter.reset("k");
    expect((await limiter.limit("k", { max: 1, windowSec: 60 })).allowed).toBe(true);
  });

  it("clears both backends when both work", async () => {
    const redis = new MemoryLimiter();
    const postgres = new MemoryLimiter();
    const limiter = createRateLimiter({ redis, postgres });
    await limiter.reset("k");
    expect(redis.resets).toEqual(["k"]);
    expect(postgres.resets).toEqual(["k"]);
  });

  it("RedisRateLimiter.reset deletes the prefixed key with the fake Redis", async () => {
    const fake = new FakeRedis();
    fake.values.set("alnamer:rl:lock:a:b", "x");
    await new RedisRateLimiter(fake.asRedis()).reset("lock:a:b");
    expect(fake.values.has("alnamer:rl:lock:a:b")).toBe(false);
    expect(fake.calls).toEqual(["del"]);
  });
});
