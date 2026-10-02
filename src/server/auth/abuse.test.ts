import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { AUTH_LIMITS } from "@/server/config/policy";
import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";
import { MemoryLimiter } from "../../../test/fake-limiter";
import {
  clearSignInFailures,
  guardCodeSend,
  guardCodeVerify,
  guardSignIn,
  guardSignUp,
} from "./abuse";

const T0 = new Date("2030-01-01T10:00:00.000Z");
const yes = async () => true;
const OPEN = {
  ...AUTH_LIMITS,
  signIn: { ip: { max: 999, windowSec: 900 }, id: { max: 999, windowSec: 900 } },
};

let limiter: MemoryLimiter;
const deps = () => ({ limiter, verifyCaptcha: yes });

type SignInArgs = Parameters<typeof guardSignIn>;
function attempt(over: Partial<SignInArgs[0]> = {}, d: SignInArgs[1] = deps()) {
  return guardSignIn(
    { identifier: "Victim@Example.com", ip: "203.0.113.5", deviceId: "dev-attacker", ...over },
    d,
  );
}

beforeEach(() => {
  setClockForTests(T0);
  limiter = new MemoryLimiter();
});
afterEach(() => {
  setClockForTests(null);
  vi.restoreAllMocks();
});

describe("keys", () => {
  it("never contain a raw email, username or IP", async () => {
    await attempt();
    await attempt({ identifier: "kid_name", deviceId: null });
    await guardSignUp({ ip: "203.0.113.5" }, deps());
    await guardCodeSend({ identifier: "Victim@Example.com", ip: "203.0.113.5" }, deps());
    await guardCodeVerify({ identifier: "Victim@Example.com" }, deps());
    const all = [...limiter.keys].join("\n").toLowerCase();
    for (const raw of ["victim", "example.com", "kid_name", "203.0.113.5"]) {
      expect(all).not.toContain(raw);
    }
    expect([...limiter.keys].some((key) => key.startsWith("rl:signin:ip:"))).toBe(true);
    expect([...limiter.keys].some((key) => key.startsWith("rl:signin:id:"))).toBe(true);
    expect([...limiter.keys].some((key) => key.startsWith("lock:"))).toBe(true);
  });

  it("hash the identifier case-insensitively", async () => {
    await attempt({ identifier: "A@B.com" });
    const before = limiter.keys.size;
    await attempt({ identifier: " a@b.COM " });
    expect(limiter.keys.size).toBe(before);
  });
});

describe("sign-in limits", () => {
  it("blocks the 21st attempt from one IP and says when it ends", async () => {
    for (let i = 0; i < AUTH_LIMITS.signIn.ip.max; i++) {
      expect(await attempt({ identifier: `u${i}@x.test`, deviceId: `d${i}` })).toEqual({
        ok: true,
      });
    }
    const blocked = await attempt({ identifier: "u99@x.test", deviceId: "d99" });
    expect(blocked).toMatchObject({ blocked: "rateLimited" });
    expect(blocked).toHaveProperty("until", new Date(T0.getTime() + 15 * 60_000));
  });

  it("blocks the 11th attempt on one identifier across devices and IPs", async () => {
    for (let i = 0; i < AUTH_LIMITS.signIn.id.max; i++) {
      expect(await attempt({ ip: `198.51.100.${i}`, deviceId: `d${i}` })).toEqual({ ok: true });
    }
    expect(await attempt({ ip: "198.51.100.99", deviceId: "d99" })).toMatchObject({
      blocked: "rateLimited",
    });
  });

  it("opens again once the window has passed", async () => {
    for (let i = 0; i < 10; i++) await attempt({ deviceId: `d${i}`, ip: `198.51.100.${i}` });
    setClockForTests(new Date(T0.getTime() + 15 * 60_000 + 1000));
    expect(await attempt({ deviceId: "fresh", ip: "198.51.100.200" })).toEqual({ ok: true });
  });
});

describe("lockout per (identifier, device)", () => {
  it("locks that pair after 10 attempts and reports when it ends", async () => {
    const d = { ...deps(), limits: OPEN };
    for (let i = 0; i < 10; i++) expect(await attempt({}, d)).toEqual({ ok: true });
    const locked = await attempt({}, d);
    expect(locked).toMatchObject({ blocked: "locked" });
    expect(locked).toHaveProperty("until", new Date(T0.getTime() + 15 * 60_000));
  });

  it("locks the attacker's pair only, not the victim's device or another identifier", async () => {
    const d = { ...deps(), limits: OPEN };
    for (let i = 0; i < 10; i++) await attempt({ deviceId: "dev-attacker" }, d);
    expect(await attempt({ deviceId: "dev-attacker" }, d)).toMatchObject({ blocked: "locked" });
    expect(await attempt({ deviceId: "dev-victim", ip: "198.51.100.7" }, d)).toEqual({ ok: true });
    expect(await attempt({ identifier: "other@x.test", deviceId: "dev-attacker" }, d)).toEqual({
      ok: true,
    });
  });

  it("without a device cookie the pair falls back to the hashed IP", async () => {
    const d = { ...deps(), limits: OPEN };
    for (let i = 0; i < 10; i++) await attempt({ deviceId: null }, d);
    expect(await attempt({ deviceId: null }, d)).toMatchObject({ blocked: "locked" });
    expect(await attempt({ deviceId: null, ip: "198.51.100.8" }, d)).toEqual({ ok: true });
  });

  it("treats an unknown identifier exactly like a known one", async () => {
    const d = { ...deps(), limits: OPEN };
    const run = async (identifier: string) => {
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await attempt({ identifier, deviceId: `dev-${identifier}` }, d);
        out.push("ok" in r ? "ok" : r.blocked);
      }
      return out;
    };
    const known = await run("known@x.test");
    expect(known.slice(-2)).toEqual(["locked", "locked"]);
    expect(await run("nobody-here@x.test")).toEqual(known);
  });

  it("clears the pair on a successful sign-in", async () => {
    const d = { ...deps(), limits: OPEN };
    for (let i = 0; i < 9; i++) await attempt({}, d);
    await clearSignInFailures(
      { identifier: "Victim@Example.com", ip: "203.0.113.5", deviceId: "dev-attacker" },
      d,
    );
    for (let i = 0; i < 10; i++) expect(await attempt({}, d)).toEqual({ ok: true });
    expect(await attempt({}, d)).toMatchObject({ blocked: "locked" });
  });
});

describe("captcha step-up", () => {
  it("is required after 3 failures on the pair, and an absent verifier fails closed", async () => {
    const d = { limiter, limits: OPEN };
    for (let i = 0; i < 3; i++) expect(await attempt({}, d)).toEqual({ ok: true });
    expect(await attempt({}, d)).toEqual({ blocked: "captchaRequired" });
    expect(await attempt({ captchaToken: "anything" }, d)).toEqual({ blocked: "captchaRequired" });
  });

  it("passes with a verifier that accepts the token", async () => {
    const seen: Array<string | undefined> = [];
    const d = {
      limiter,
      limits: OPEN,
      verifyCaptcha: async (token: string | undefined) => {
        seen.push(token);
        return token === "good";
      },
    };
    for (let i = 0; i < 3; i++) await attempt({}, d);
    expect(await attempt({ captchaToken: "bad" }, d)).toEqual({ blocked: "captchaRequired" });
    expect(await attempt({ captchaToken: "good" }, d)).toEqual({ ok: true });
    expect(seen).toEqual(["bad", "good"]);
  });

  it("is required on every device once the account-wide counter is exceeded, and never locks", async () => {
    const limits = { ...OPEN, lockout: { ...OPEN.lockout, account: { max: 5, windowSec: 900 } } };
    const d = { limiter, limits };
    for (let i = 0; i < 5; i++) {
      expect(await attempt({ deviceId: `d${i}`, ip: `198.51.100.${i}` }, d)).toEqual({ ok: true });
    }
    const victim = { deviceId: "victim", ip: "198.51.100.77" };
    expect(await attempt(victim, d)).toEqual({ blocked: "captchaRequired" });
    expect(await attempt(victim, { ...d, verifyCaptcha: yes })).toEqual({ ok: true });
  });
});

describe("other actions", () => {
  it("sign-up: 5 per IP per hour", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await guardSignUp({ ip: "203.0.113.5" }, deps())).toEqual({ ok: true });
    }
    expect(await guardSignUp({ ip: "203.0.113.5" }, deps())).toMatchObject({
      blocked: "rateLimited",
    });
    expect(await guardSignUp({ ip: "203.0.113.6" }, deps())).toEqual({ ok: true });
  });

  it("code send: 3 per account per 15 minutes, 10 per IP per hour", async () => {
    for (let i = 0; i < 3; i++) {
      const out = await guardCodeSend({ identifier: "a@x.test", ip: `198.51.100.${i}` }, deps());
      expect(out).toEqual({ ok: true });
    }
    expect(
      await guardCodeSend({ identifier: "A@x.test", ip: "198.51.100.50" }, deps()),
    ).toMatchObject({ blocked: "rateLimited" });
    for (let i = 0; i < 10; i++) {
      const out = await guardCodeSend({ identifier: `u${i}@x.test`, ip: "203.0.113.9" }, deps());
      expect(out).toEqual({ ok: true });
    }
    expect(
      await guardCodeSend({ identifier: "u99@x.test", ip: "203.0.113.9" }, deps()),
    ).toMatchObject({ blocked: "rateLimited" });
  });

  it("code verify: 10 per account per 15 minutes", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await guardCodeVerify({ identifier: "a@x.test" }, deps())).toEqual({ ok: true });
    }
    expect(await guardCodeVerify({ identifier: "a@x.test" }, deps())).toMatchObject({
      blocked: "rateLimited",
    });
  });
});

describe("Redis down", () => {
  it("still limits sign-in through Postgres and logs the alert once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: RateLimiter = {
      limit: () => Promise.reject(new Error("redis down")),
      reset: () => Promise.reject(new Error("redis down")),
    };
    const degraded = createRateLimiter({ redis: failing, postgres: new MemoryLimiter() });
    const d = { limiter: degraded, verifyCaptcha: yes };
    for (let i = 0; i < 10; i++) {
      await attempt({ deviceId: `d${i}`, ip: `198.51.100.${i}` }, d);
    }
    expect(await attempt({ deviceId: "d99", ip: "198.51.100.99" }, d)).toMatchObject({
      blocked: "rateLimited",
    });
    const alerts = error.mock.calls.filter((call) => call[0] === "[alert] rate_limiter_degraded");
    expect(alerts).toHaveLength(1);
  });
});
