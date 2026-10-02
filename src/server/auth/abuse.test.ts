import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { AUTH_LIMITS } from "@/server/config/policy";
import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";
import { MemoryLimiter } from "../../../test/fake-limiter";
import {
  clearCodeVerifyFailures,
  clearSignInFailures,
  guardCodeSend,
  guardCodeVerify,
  guardSignIn,
  guardSignUp,
  guardSupportRequest,
} from "./abuse";
import { createCaptchaVerifier } from "./captcha";
import { deriveKey } from "./keys";

const T0 = new Date("2030-01-01T10:00:00.000Z");
const yes = async () => true;
const OPEN = {
  ...AUTH_LIMITS,
  signIn: { ip: { max: 999, windowSec: 900 } },
};

const VERIFY = {
  purpose: "password_reset" as const,
  identifier: "victim@example.com",
  ip: "203.0.113.5",
  deviceId: "dev-attacker" as string | null,
};
let limiter: MemoryLimiter;
const RL_KEY = deriveKey("t".repeat(40), "rl");
const deps = () => ({ limiter, verifyCaptcha: yes, key: RL_KEY });

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
    await guardCodeVerify({ ...VERIFY, identifier: "Victim@Example.com" }, deps());
    const all = [...limiter.keys].join("\n").toLowerCase();
    for (const raw of ["victim", "example.com", "kid_name", "203.0.113.5"]) {
      expect(all).not.toContain(raw);
    }
    expect([...limiter.keys].some((key) => key.startsWith("rl:signin:ip:"))).toBe(true);
    expect([...limiter.keys].some((key) => key.startsWith("rl:signin:id:"))).toBe(false);
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

  it("has no per-identifier hard limit: 25 attempts on one identifier across IPs are never rateLimited", async () => {
    for (let i = 0; i < 25; i++) {
      expect(await attempt({ ip: `198.51.100.${i}`, deviceId: `d${i}` })).toEqual({ ok: true });
    }
  });

  it("10 attacker attempts from another device leave the victim's device signing in without a captcha", async () => {
    const neverAsked = {
      limiter,
      key: RL_KEY,
      verifyCaptcha: async () => {
        throw new Error("a captcha must not be required here");
      },
    };
    for (let i = 0; i < 10; i++) {
      expect(await attempt({ deviceId: "dev-attacker", ip: "203.0.113.5" })).toEqual({ ok: true });
    }
    expect(await attempt({ deviceId: "dev-victim", ip: "198.51.100.7" }, neverAsked)).toEqual({
      ok: true,
    });
  });

  it("opens again once the window has passed", async () => {
    for (let i = 0; i < AUTH_LIMITS.signIn.ip.max; i++) {
      await attempt({ identifier: `u${i}@x.test`, deviceId: `d${i}` });
    }
    expect(await attempt({ identifier: "late@x.test", deviceId: "dl" })).toMatchObject({
      blocked: "rateLimited",
    });
    setClockForTests(new Date(T0.getTime() + 15 * 60_000 + 1000));
    expect(await attempt({ identifier: "late@x.test", deviceId: "dl" })).toEqual({ ok: true });
  });
});

describe("lockout per (identifier, device)", () => {
  it("locks that pair after 10 attempts and reports when it ends", async () => {
    const d = deps();
    for (let i = 0; i < 10; i++) expect(await attempt({}, d)).toEqual({ ok: true });
    const locked = await attempt({}, d);
    expect(locked).toMatchObject({ blocked: "locked" });
    expect(locked).toHaveProperty("until", new Date(T0.getTime() + 15 * 60_000));
  });

  it("locks the attacker's pair only, not the victim's device or another identifier", async () => {
    const d = deps();
    for (let i = 0; i < 10; i++) await attempt({ deviceId: "dev-attacker" }, d);
    expect(await attempt({ deviceId: "dev-attacker" }, d)).toMatchObject({ blocked: "locked" });
    expect(await attempt({ deviceId: "dev-victim", ip: "198.51.100.7" }, d)).toEqual({ ok: true });
    expect(await attempt({ identifier: "other@x.test", deviceId: "dev-attacker" }, d)).toEqual({
      ok: true,
    });
  });

  it("without a device cookie the pair falls back to the hashed IP", async () => {
    const d = deps();
    for (let i = 0; i < 10; i++) await attempt({ deviceId: null }, d);
    expect(await attempt({ deviceId: null }, d)).toMatchObject({ blocked: "locked" });
    expect(await attempt({ deviceId: null, ip: "198.51.100.8" }, d)).toEqual({ ok: true });
  });

  it("treats an unknown identifier exactly like a known one", async () => {
    const d = deps();
    const run = async (identifier: string, ip: string) => {
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await attempt({ identifier, ip, deviceId: `dev-${identifier}` }, d);
        out.push("ok" in r ? "ok" : r.blocked);
      }
      return out;
    };
    const known = await run("known@x.test", "198.51.100.1");
    expect(known.slice(-2)).toEqual(["locked", "locked"]);
    expect(await run("nobody-here@x.test", "198.51.100.2")).toEqual(known);
  });

  it("clears the pair on a successful sign-in", async () => {
    const d = deps();
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
  it("is required after 3 failures on the pair; the fake provider rejects a missing or forced-fail token", async () => {
    const d = {
      limiter,
      key: RL_KEY,
      limits: OPEN,
      verifyCaptcha: createCaptchaVerifier({ provider: "fake" }),
    };
    for (let i = 0; i < 3; i++) expect(await attempt({}, d)).toEqual({ ok: true });
    expect(await attempt({}, d)).toEqual({ blocked: "captchaRequired" });
    expect(await attempt({ captchaToken: "fail" }, d)).toEqual({ blocked: "captchaRequired" });
    expect(await attempt({ captchaToken: "fake-ok" }, d)).toEqual({ ok: true });
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
    const d = {
      limiter,
      key: RL_KEY,
      limits,
      verifyCaptcha: createCaptchaVerifier({ provider: "fake" }),
    };
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
});

describe("Redis down", () => {
  it("still limits sign-in through Postgres and logs the alert once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: RateLimiter = {
      limit: () => Promise.reject(new Error("redis down")),
      reset: () => Promise.reject(new Error("redis down")),
    };
    const degraded = createRateLimiter({ redis: failing, postgres: new MemoryLimiter() });
    const d = { limiter: degraded, key: RL_KEY, verifyCaptcha: yes };
    for (let i = 0; i < AUTH_LIMITS.signIn.ip.max; i++) {
      await attempt({ deviceId: `d${i}`, ip: "198.51.100.1" }, d);
    }
    expect(await attempt({ deviceId: "d99", ip: "198.51.100.1" }, d)).toMatchObject({
      blocked: "rateLimited",
    });
    const alerts = error.mock.calls.filter((call) => call[0] === "[alert] rate_limiter_degraded");
    expect(alerts).toHaveLength(1);
  });
});

describe("keyed hashes", () => {
  it("are not bare sha256 and change with the key", async () => {
    await attempt();
    const bare = createHash("sha256").update("203.0.113.5").digest("hex");
    expect([...limiter.keys].join(" ")).not.toContain(bare);
    const other = new MemoryLimiter();
    await attempt({}, { limiter: other, verifyCaptcha: yes, key: deriveKey("u".repeat(40), "rl") });
    expect([...other.keys].sort()).not.toEqual([...limiter.keys].sort());
  });
});

describe("code verify (D32 pattern)", () => {
  const verify = (
    over: Partial<typeof VERIFY & { captchaToken?: string }> = {},
    d: Parameters<typeof guardCodeVerify>[1] = deps(),
  ) => guardCodeVerify({ ...VERIFY, ...over }, d);

  it("locks the (identifier, device) pair at 10 failed verifies and says when it ends", async () => {
    for (let i = 0; i < 10; i++) expect(await verify()).toEqual({ ok: true });
    const locked = await verify();
    expect(locked).toMatchObject({ blocked: "locked" });
    expect(locked).toHaveProperty("until", new Date(T0.getTime() + 15 * 60_000));
  });

  it("an attacker's pair never locks the victim's device or another identifier", async () => {
    for (let i = 0; i < 11; i++) await verify();
    expect(await verify({ deviceId: "dev-victim", ip: "198.51.100.7" })).toEqual({ ok: true });
    expect(await verify({ identifier: "other@example.com" })).toEqual({ ok: true });
  });

  it("without a device cookie the pair falls back to the hashed IP", async () => {
    for (let i = 0; i < 10; i++) await verify({ deviceId: null });
    expect(await verify({ deviceId: null })).toMatchObject({ blocked: "locked" });
    expect(await verify({ deviceId: null, ip: "198.51.100.8" })).toEqual({ ok: true });
  });

  it("counts reset and email verification separately", async () => {
    for (let i = 0; i < 10; i++) await verify();
    expect(await verify({ purpose: "email_verify" as never })).toEqual({ ok: true });
  });

  it("clears the pair after a successful verify", async () => {
    for (let i = 0; i < 9; i++) await verify();
    await clearCodeVerifyFailures(VERIFY, deps());
    for (let i = 0; i < 10; i++) expect(await verify()).toEqual({ ok: true });
    expect(await verify()).toMatchObject({ blocked: "locked" });
  });

  it("requires a captcha on every device once the account-wide counter is exceeded, and never blocks", async () => {
    const limits = {
      ...AUTH_LIMITS,
      codeVerify: { ...AUTH_LIMITS.codeVerify, account: { max: 5, windowSec: 900 } },
    };
    const d = {
      limiter,
      key: RL_KEY,
      limits,
      verifyCaptcha: createCaptchaVerifier({ provider: "fake" }),
    };
    for (let i = 0; i < 5; i++) {
      expect(await verify({ deviceId: `d${i}`, ip: `198.51.100.${i}` }, d)).toEqual({ ok: true });
    }
    const victim = { deviceId: "victim", ip: "198.51.100.77" };
    expect(await verify(victim, d)).toEqual({ blocked: "captchaRequired" });
    expect(await verify({ ...victim, captchaToken: "fail" }, d)).toEqual({
      blocked: "captchaRequired",
    });
    expect(await verify({ ...victim, captchaToken: "fake-ok" }, d)).toEqual({ ok: true });
  });

  it("is the same for an unknown identifier", async () => {
    const run = async (identifier: string) => {
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await verify({ identifier, deviceId: `dev-${identifier}` });
        out.push("ok" in r ? "ok" : r.blocked);
      }
      return out;
    };
    expect(await run("nobody@example.com")).toEqual(await run("real@example.com"));
  });
});

describe("support requests", () => {
  it("allows 3 a day per user and blocks the 4th with the window end", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await guardSupportRequest({ userId: "u1" }, deps())).toEqual({ ok: true });
    }
    const blocked = await guardSupportRequest({ userId: "u1" }, deps());
    expect(blocked).toMatchObject({ blocked: "rateLimited" });
    expect(await guardSupportRequest({ userId: "u2" }, deps())).toEqual({ ok: true });
  });

  it("keys on a keyed hash, never the raw user id", async () => {
    await guardSupportRequest({ userId: "user-id-123" }, deps());
    expect([...limiter.keys].join("\n")).not.toContain("user-id-123");
  });
});
