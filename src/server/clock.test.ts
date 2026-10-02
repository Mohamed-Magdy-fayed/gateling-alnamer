import { afterEach, describe, expect, it, vi } from "vitest";
import { clock, setClockForTests } from "./clock";

afterEach(() => {
  vi.unstubAllEnvs();
  setClockForTests(null);
});

describe("clock", () => {
  it("returns real time by default", () => {
    const before = Date.now();
    const now = clock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("can be overridden and reset", () => {
    const fixed = new Date("2030-01-01T00:00:00Z");
    setClockForTests(fixed);
    expect(clock.now().getTime()).toBe(fixed.getTime());
    setClockForTests(null);
    expect(clock.now().getTime()).not.toBe(fixed.getTime());
  });

  it("returns a copy so callers cannot mutate the override", () => {
    setClockForTests(new Date("2030-01-01T00:00:00Z"));
    clock.now().setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2030);
  });

  it("refuses an override when VERCEL is set", () => {
    vi.stubEnv("VERCEL", "1");
    expect(() => setClockForTests(new Date())).toThrow();
  });
});
