import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { SESSION_CACHE_TTL_SEC, SESSION_TTL_MS } from "@/server/config/policy";
import { FakeCookieStore } from "../../../test/fake-cookies";
import { FakeRedis } from "../../../test/fake-redis";
import { sha256 } from "./password";
import type { SessionRecord } from "./session-repo";

const h = vi.hoisted(() => ({
  store: null as unknown as FakeCookieStore,
  touchDevice: vi.fn(),
  redis: null as unknown as FakeRedis | null,
  repo: {
    findSession: vi.fn(),
    insertSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteUserSessions: vi.fn(),
    setSessionDevice: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => h.store }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/server/redis", () => ({ getRedis: () => h.redis?.asRedis() ?? null }));
vi.mock("./session-repo", () => h.repo);
// Revocation runs in a transaction that also deletes pre-sessions (A8 L1).
vi.mock("@/server/db", () => ({
  db: () => ({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ delete: () => ({ where: async () => undefined }) }),
  }),
}));
vi.mock("@/server/devices/service", () => ({ touchDevice: h.touchDevice }));

const {
  attachDeviceToSession,
  createSession,
  destroySession,
  getCurrentUser,
  invalidateUserSessions,
  rotateSession,
} = await import("./session");
const { proxy } = await import("@/proxy");

const NOW = new Date("2026-10-02T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const TOKEN = "tok-abc";
const HASH = sha256(TOKEN);

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    userId: "user-1",
    name: "Sam",
    email: "sam@example.test",
    role: "student",
    status: "active",
    expiresAt: new Date(NOW.getTime() + 25 * DAY),
    deviceId: null,
    twoFactorVerified: false,
    lastSeenAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

beforeEach(() => {
  setClockForTests(NOW);
  h.store = new FakeCookieStore();
  h.redis = new FakeRedis();
  for (const fn of Object.values(h.repo)) fn.mockReset();
  h.touchDevice.mockReset();
  h.touchDevice.mockResolvedValue(false);
  h.repo.findSession.mockResolvedValue(record());
  h.repo.insertSession.mockResolvedValue(undefined);
  h.repo.updateSession.mockResolvedValue(1);
  h.repo.deleteSession.mockResolvedValue(undefined);
  h.repo.deleteUserSessions.mockResolvedValue([]);
});

afterEach(() => {
  setClockForTests(null);
  vi.restoreAllMocks();
});

const redis = () => h.redis as FakeRedis;

describe("session cookie", () => {
  it("createSession sets a host-only __Host-session cookie and clears the legacy name", async () => {
    h.store.jar.set("alnamer_session", "old");
    await createSession("user-1");

    const write = h.store.lastWrite("__Host-session");
    expect(write?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(write?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(NOW.getTime() + SESSION_TTL_MS),
    });
    expect(write?.options).not.toHaveProperty("domain");
    expect(h.store.jar.has("alnamer_session")).toBe(false);
    expect(h.repo.insertSession).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: sha256(write?.value ?? ""), userId: "user-1" }),
    );
  });

  it("the delete write keeps Secure so a browser accepts it for a __Host- name", async () => {
    h.store.jar.set("__Host-session", TOKEN);
    await destroySession();
    expect(h.store.lastWrite("__Host-session")?.options).toMatchObject({
      secure: true,
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
  });

  it("rotateSession swaps the token, keeps device and 2FA flags, and drops the old row and cache", async () => {
    h.store.jar.set("__Host-session", TOKEN);
    h.repo.findSession.mockResolvedValue(record({ deviceId: "dev-1", twoFactorVerified: true }));
    await getCurrentUser(); // primes the cache for the old token
    expect(redis().values.has(`sess:${HASH}`)).toBe(true);

    await rotateSession();

    const fresh = h.store.lastWrite("__Host-session")?.value ?? "";
    expect(fresh).not.toBe(TOKEN);
    expect(h.repo.insertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: sha256(fresh),
        userId: "user-1",
        deviceId: "dev-1",
        twoFactorVerified: true,
      }),
    );
    expect(h.repo.deleteSession).toHaveBeenCalledWith(HASH);
    expect(redis().values.has(`sess:${HASH}`)).toBe(false);
  });

  it("destroySession deletes the row, the cache key and both cookies", async () => {
    h.store.jar.set("__Host-session", TOKEN);
    h.store.jar.set("alnamer_session", TOKEN);
    await getCurrentUser();
    await destroySession();
    expect(h.repo.deleteSession).toHaveBeenCalledWith(HASH);
    expect(redis().values.has(`sess:${HASH}`)).toBe(false);
    expect(h.store.jar.size).toBe(0);
  });
});

describe("legacy cookie", () => {
  it("is never read: a request with only alnamer_session is signed out", async () => {
    h.store.jar.set("alnamer_session", TOKEN);
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(h.repo.findSession).not.toHaveBeenCalled();
  });

  it("prefers __Host-session when both are present", async () => {
    h.store.jar.set("__Host-session", TOKEN);
    h.store.jar.set("alnamer_session", "other");
    await getCurrentUser();
    expect(h.repo.findSession).toHaveBeenCalledWith(HASH, expect.any(Date));
  });

  it("the proxy never promotes a legacy value, it only deletes the old cookie", () => {
    const response = proxy(
      new NextRequest("http://localhost:3410/dashboard", {
        headers: { cookie: `alnamer_session=${TOKEN}` },
      }),
    );
    expect(response.cookies.get("__Host-session")).toBeUndefined();
    expect(response.cookies.get("alnamer_session")?.value).toBe("");
  });

  it("the proxy touches no legacy cookie when none is present", () => {
    const response = proxy(
      new NextRequest("http://localhost:3410/", { headers: { cookie: `__Host-session=${TOKEN}` } }),
    );
    expect(response.cookies.get("alnamer_session")).toBeUndefined();
  });

  it("the proxy refreshes the cookie expiry at most once a day", () => {
    const first = proxy(
      new NextRequest("http://localhost:3410/", { headers: { cookie: `__Host-session=${TOKEN}` } }),
    );
    expect(first.cookies.get("__Host-session")?.value).toBe(TOKEN);
    const marker = first.cookies.get("__Host-session-refreshed")?.value ?? "";
    expect(marker).not.toBe("");

    setClockForTests(new Date(NOW.getTime() + 60 * 60 * 1000));
    const soon = proxy(
      new NextRequest("http://localhost:3410/", {
        headers: { cookie: `__Host-session=${TOKEN}; __Host-session-refreshed=${marker}` },
      }),
    );
    expect(soon.cookies.get("__Host-session")).toBeUndefined();

    setClockForTests(new Date(NOW.getTime() + DAY + 1000));
    const later = proxy(
      new NextRequest("http://localhost:3410/", {
        headers: { cookie: `__Host-session=${TOKEN}; __Host-session-refreshed=${marker}` },
      }),
    );
    expect(later.cookies.get("__Host-session")?.value).toBe(TOKEN);
  });

  it("the proxy leaves a request without session cookies alone", () => {
    const response = proxy(new NextRequest("http://localhost:3410/"));
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("sliding expiry and last_seen_at", () => {
  beforeEach(() => h.store.jar.set("__Host-session", TOKEN));

  it("extends to a full TTL when less than 15 days remain", async () => {
    h.repo.findSession.mockResolvedValue(record({ expiresAt: new Date(NOW.getTime() + 10 * DAY) }));
    await getCurrentUser();
    expect(h.repo.updateSession).toHaveBeenCalledWith(
      HASH,
      expect.objectContaining({ expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS) }),
    );
  });

  it("does not extend when 15 days or more remain", async () => {
    h.repo.findSession.mockResolvedValue(record({ expiresAt: new Date(NOW.getTime() + 15 * DAY) }));
    await getCurrentUser();
    const extended = h.repo.updateSession.mock.calls.some(([, patch]) => "expiresAt" in patch);
    expect(extended).toBe(false);
  });

  it("extends at most once: the cache carries the new expiry for the next read", async () => {
    h.repo.findSession.mockResolvedValue(record({ expiresAt: new Date(NOW.getTime() + 10 * DAY) }));
    await getCurrentUser();
    setClockForTests(new Date(NOW.getTime() + 30_000));
    await getCurrentUser();
    const extensions = h.repo.updateSession.mock.calls.filter(([, patch]) => "expiresAt" in patch);
    expect(extensions).toHaveLength(1);
  });

  it("writes last_seen_at only when it is older than 5 minutes", async () => {
    h.repo.findSession.mockResolvedValue(
      record({ lastSeenAt: new Date(NOW.getTime() - 4 * 60_000) }),
    );
    await getCurrentUser();
    expect(h.repo.updateSession).not.toHaveBeenCalled();

    h.redis = new FakeRedis();
    h.repo.findSession.mockResolvedValue(
      record({ lastSeenAt: new Date(NOW.getTime() - 6 * 60_000) }),
    );
    await getCurrentUser();
    expect(h.repo.updateSession).toHaveBeenCalledWith(HASH, { lastSeenAt: NOW });
  });

  it("touches the session's device whenever the session's last_seen is refreshed", async () => {
    h.repo.findSession.mockResolvedValue(
      record({ deviceId: "dev-1", lastSeenAt: new Date(NOW.getTime() - 4 * 60_000) }),
    );
    await getCurrentUser();
    expect(h.touchDevice).not.toHaveBeenCalled();

    h.redis = new FakeRedis();
    h.repo.findSession.mockResolvedValue(
      record({ deviceId: "dev-1", lastSeenAt: new Date(NOW.getTime() - 6 * 60_000) }),
    );
    await getCurrentUser();
    expect(h.touchDevice).toHaveBeenCalledWith("dev-1");
  });

  it("does not touch a device for a session without one", async () => {
    h.repo.findSession.mockResolvedValue(record({ deviceId: null, lastSeenAt: null }));
    await getCurrentUser();
    expect(h.touchDevice).not.toHaveBeenCalled();
  });

  it("a failing device touch does not fail the read", async () => {
    h.repo.findSession.mockResolvedValue(record({ deviceId: "dev-1", lastSeenAt: null }));
    h.touchDevice.mockRejectedValue(new Error("db busy"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getCurrentUser()).resolves.toMatchObject({ id: "user-1" });
  });

  it("attachDeviceToSession sets the device on the row and drops the cached copy", async () => {
    h.store.jar.set("__Host-session", TOKEN);
    await getCurrentUser(); // primes the cache
    expect(redis().values.has(`sess:${HASH}`)).toBe(true);
    await attachDeviceToSession("dev-7");
    expect(h.repo.setSessionDevice).toHaveBeenCalledWith(HASH, "dev-7");
    expect(redis().values.has(`sess:${HASH}`)).toBe(false);
  });

  it("writes last_seen_at when it has never been set", async () => {
    h.repo.findSession.mockResolvedValue(record({ lastSeenAt: null }));
    await getCurrentUser();
    expect(h.repo.updateSession).toHaveBeenCalledWith(HASH, { lastSeenAt: NOW });
  });

  it("a failed housekeeping write does not fail the read", async () => {
    h.repo.findSession.mockResolvedValue(record({ lastSeenAt: null }));
    h.repo.updateSession.mockRejectedValue(new Error("db busy"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getCurrentUser()).resolves.toMatchObject({ id: "user-1" });
  });
});

describe("redis cache", () => {
  beforeEach(() => h.store.jar.set("__Host-session", TOKEN));

  it("a miss reads the DB and populates sess:<hash> with a 60 s TTL, indexed under usess:<user>", async () => {
    await getCurrentUser();
    expect(h.repo.findSession).toHaveBeenCalledTimes(1);
    expect(redis().ttls.get(`sess:${HASH}`)).toBe(60);
    expect(SESSION_CACHE_TTL_SEC).toBe(60);
    expect(redis().sets.get("usess:user-1")).toEqual(new Set([`sess:${HASH}`]));
    const cached = JSON.parse(String(redis().values.get(`sess:${HASH}`)));
    expect(cached).toMatchObject({
      userId: "user-1",
      role: "student",
      name: "Sam",
      email: "sam@example.test",
      status: "active",
      deviceId: null,
      twoFactorVerified: false,
    });
  });

  it("a hit does not touch the DB", async () => {
    await getCurrentUser();
    h.repo.findSession.mockClear();
    h.repo.findSession.mockRejectedValue(new Error("DB must not be read"));
    await expect(getCurrentUser()).resolves.toMatchObject({ id: "user-1" });
    expect(h.repo.findSession).not.toHaveBeenCalled();
  });

  it("rejects a suspended user even when the session is cached", async () => {
    await getCurrentUser();
    const key = `sess:${HASH}`;
    const cached = JSON.parse(String(redis().values.get(key)));
    redis().values.set(key, JSON.stringify({ ...cached, status: "suspended" }));
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("rejects a cached session whose expiry has passed", async () => {
    await getCurrentUser();
    setClockForTests(new Date(NOW.getTime() + 40 * DAY));
    h.repo.findSession.mockResolvedValue(null);
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("works from the DB alone when Redis is not configured", async () => {
    h.redis = null;
    await expect(getCurrentUser()).resolves.toMatchObject({ id: "user-1" });
    await expect(getCurrentUser()).resolves.toMatchObject({ id: "user-1" });
    expect(h.repo.findSession).toHaveBeenCalledTimes(2);
  });

  it("falls back to the DB when Redis errors", async () => {
    redis().failing = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getCurrentUser()).resolves.toMatchObject({ id: "user-1" });
  });

  it("returns null for an unknown token and caches nothing", async () => {
    h.repo.findSession.mockResolvedValue(null);
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(redis().values.size).toBe(0);
  });

  it("invalidateUserSessions denies a cached session on the very next read", async () => {
    await getCurrentUser();
    h.repo.deleteUserSessions.mockResolvedValue([HASH]);
    h.repo.findSession.mockResolvedValue(null);
    await invalidateUserSessions("user-1");
    expect(h.repo.deleteUserSessions).toHaveBeenCalledWith("user-1", undefined, expect.anything());
    expect(redis().values.has(`sess:${HASH}`)).toBe(false);
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("invalidateUserSessions keeps the excepted session's row and cache entry", async () => {
    await getCurrentUser();
    redis().values.set("sess:other", "{}");
    await redis().sadd("usess:user-1", "sess:other");
    h.repo.deleteUserSessions.mockResolvedValue(["other"]);
    await invalidateUserSessions("user-1", { exceptTokenHash: HASH });
    expect(h.repo.deleteUserSessions).toHaveBeenCalledWith("user-1", HASH, expect.anything());
    expect(redis().values.has("sess:other")).toBe(false);
    expect(redis().values.has(`sess:${HASH}`)).toBe(true);
  });

  it("invalidateUserSessions still deletes DB rows when Redis is down", async () => {
    redis().failing = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await invalidateUserSessions("user-1");
    expect(h.repo.deleteUserSessions).toHaveBeenCalled();
  });
});

describe("revoked session resurrection", () => {
  beforeEach(() => h.store.jar.set("__Host-session", TOKEN));

  it("a cache hit whose row was deleted is denied and not written back to the cache", async () => {
    await getCurrentUser(); // primes the cache
    redis().calls.length = 0;
    h.repo.updateSession.mockResolvedValue(0); // the row is gone
    setClockForTests(new Date(NOW.getTime() + 10 * 60_000)); // last_seen_at is due
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(redis().calls).not.toContain("set");
  });

  it("a DB hit whose row vanished before the housekeeping write is denied and not cached", async () => {
    h.repo.findSession.mockResolvedValue(record({ lastSeenAt: null }));
    h.repo.updateSession.mockResolvedValue(0);
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(redis().values.size).toBe(0);
  });

  it("invalidateUserSessions deletes the known hashes even when the index read fails", async () => {
    await getCurrentUser();
    expect(redis().values.has(`sess:${HASH}`)).toBe(true);
    h.repo.deleteUserSessions.mockResolvedValue([HASH]);
    vi.spyOn(redis(), "smembers").mockRejectedValue(new Error("redis blip"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await invalidateUserSessions("user-1");
    expect(redis().values.has(`sess:${HASH}`)).toBe(false);
  });
});
