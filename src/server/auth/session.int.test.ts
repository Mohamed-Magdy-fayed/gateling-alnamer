import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { SESSION_TTL_MS } from "@/server/config/policy";
import { auditLog, devices, sessions, users } from "@/server/db/schema";
import { FakeCookieStore } from "../../../test/fake-cookies";
import { FakeRedis } from "../../../test/fake-redis";
import { sha256 } from "./password";

const h = vi.hoisted(() => ({
  store: null as unknown as FakeCookieStore,
  redis: null as unknown as FakeRedis | null,
}));

vi.mock("next/headers", () => ({ cookies: async () => h.store }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/server/redis", () => ({ getRedis: () => h.redis?.asRedis() ?? null }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 3, onnotice: () => {} });
  const conn = drizzle(client, { schema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => ReturnType<typeof import("drizzle-orm/postgres-js").drizzle>;
  closeTestDb: () => Promise<void>;
};
const { createSession, destroySession, getCurrentUser, invalidateUserSessions, rotateSession } =
  await import("./session");

const db = () =>
  dbModule.db() as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
    typeof import("@/server/db/schema")
  >;

const NOW = new Date("2030-03-01T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

async function makeUser(label: string, status: "active" | "suspended" = "active") {
  const [user] = await db()
    .insert(users)
    .values({ name: label, email: `${label}-${crypto.randomUUID()}@example.test`, status })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  return user.id;
}

async function rowFor(token: string) {
  const [row] = await db()
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, sha256(token)));
  return row;
}

const redis = () => h.redis as FakeRedis;
const cookieToken = () => h.store.jar.get("__Host-session") ?? "";

beforeEach(() => {
  setClockForTests(NOW);
  h.store = new FakeCookieStore();
  h.redis = new FakeRedis();
});

afterEach(() => {
  setClockForTests(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dbModule.closeTestDb();
});

describe("sessions per device (D34)", () => {
  async function makeDevice(userId: string) {
    const [row] = await db()
      .insert(devices)
      .values({ userId, deviceKey: crypto.randomUUID() })
      .returning({ id: devices.id });
    if (!row) throw new Error("no device");
    return row.id;
  }
  /** An older session on the device, created `agoMin` minutes before real time. */
  async function seed(userId: string, deviceId: string, agoMin: number) {
    const tokenHash = crypto.randomUUID();
    await db()
      .insert(sessions)
      .values({
        tokenHash,
        userId,
        deviceId,
        expiresAt: new Date(NOW.getTime() + DAY),
        createdAt: new Date(Date.now() - agoMin * 60_000),
      });
    return tokenHash;
  }
  const liveHashes = async (deviceId: string) =>
    (await db().select().from(sessions).where(eq(sessions.deviceId, deviceId))).map(
      (r) => r.tokenHash,
    );
  const capAudits = async (deviceId: string) =>
    db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "device.session_cap"), eq(auditLog.subjectId, deviceId)));

  it("keeps the newest 3 sessions of a device and revokes the oldest, with one audit row a day", async () => {
    const userId = await makeUser("cap");
    const deviceId = await makeDevice(userId);
    const oldest = await seed(userId, deviceId, 30);
    const mid = await seed(userId, deviceId, 20);
    const newer = await seed(userId, deviceId, 10);

    await createSession(userId, { deviceId });
    const kept = await liveHashes(deviceId);
    expect(kept).toHaveLength(3);
    expect(kept).not.toContain(oldest);
    expect(kept).toEqual(expect.arrayContaining([mid, newer, sha256(cookieToken())]));
    expect(await capAudits(deviceId)).toHaveLength(1);

    await createSession(userId, { deviceId }); // same day: capped again, no second audit row
    expect(await liveHashes(deviceId)).toHaveLength(3);
    expect(await capAudits(deviceId)).toHaveLength(1);

    setClockForTests(new Date(NOW.getTime() + DAY)); // next Cairo day
    await createSession(userId, { deviceId });
    expect(await capAudits(deviceId)).toHaveLength(2);
  });

  it("purges the revoked sessions from the cache and leaves other devices and users alone", async () => {
    const userId = await makeUser("cap2");
    const deviceId = await makeDevice(userId);
    const otherDevice = await makeDevice(userId);
    const keepOther = await seed(userId, otherDevice, 5);
    const oldest = await seed(userId, deviceId, 30);
    await seed(userId, deviceId, 20);
    await seed(userId, deviceId, 10);
    redis().values.set(`sess:${oldest}`, "x");

    await createSession(userId, { deviceId });
    expect(await liveHashes(otherDevice)).toEqual([keepOther]);
    expect(redis().values.has(`sess:${oldest}`)).toBe(false);
  });

  it("does nothing under the cap or for a session with no device", async () => {
    const userId = await makeUser("cap3");
    const deviceId = await makeDevice(userId);
    await seed(userId, deviceId, 10);
    await createSession(userId, { deviceId });
    expect(await liveHashes(deviceId)).toHaveLength(2);
    expect(await capAudits(deviceId)).toHaveLength(0);
    await createSession(userId);
  });
});

describe("create, rotate, revoke", () => {
  it("createSession stores a hashed row with a 30-day expiry and signs the user in", async () => {
    const userId = await makeUser("create");
    await createSession(userId);

    const token = cookieToken();
    const row = await rowFor(token);
    expect(row).toMatchObject({ userId, twoFactorVerified: false });
    expect(row?.tokenHash).toBe(sha256(token));
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + SESSION_TTL_MS);
    await expect(getCurrentUser()).resolves.toMatchObject({
      id: userId,
      role: "student",
      status: "active",
    });
  });

  it("rotateSession replaces the row and the cookie token for the same user", async () => {
    const userId = await makeUser("rotate");
    await createSession(userId);
    const oldToken = cookieToken();
    await getCurrentUser(); // cached under the old token

    await rotateSession();

    const newToken = cookieToken();
    expect(newToken).not.toBe(oldToken);
    expect(await rowFor(oldToken)).toBeUndefined();
    expect((await rowFor(newToken))?.userId).toBe(userId);
    expect(redis().values.has(`sess:${sha256(oldToken)}`)).toBe(false);
    await expect(getCurrentUser()).resolves.toMatchObject({ id: userId });
  });

  it("destroySession revokes the row and the next read is signed out", async () => {
    const userId = await makeUser("revoke");
    await createSession(userId);
    const token = cookieToken();
    await getCurrentUser();

    await destroySession();

    expect(await rowFor(token)).toBeUndefined();
    h.store.jar.set("__Host-session", token); // a stolen copy of the cookie
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("an expired row is not a session", async () => {
    const userId = await makeUser("expired");
    await createSession(userId);
    setClockForTests(new Date(NOW.getTime() + SESSION_TTL_MS + 1000));
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

describe("legacy cookie", () => {
  it("a session token presented only under the old cookie name is not honoured", async () => {
    const userId = await makeUser("legacy");
    await createSession(userId);
    const token = cookieToken();
    h.store.jar.clear();
    h.store.jar.set("alnamer_session", token);
    h.store.readOnly = true;

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

describe("sliding expiry and last_seen_at", () => {
  it("extends expires_at to now + 30 days when less than 15 days remain, and not again within the day", async () => {
    const userId = await makeUser("slide");
    await createSession(userId);
    const token = cookieToken();
    const tokenHash = sha256(token);

    setClockForTests(new Date(NOW.getTime() + 20 * DAY)); // 10 days left
    await getCurrentUser();
    const extended = new Date(NOW.getTime() + 20 * DAY + SESSION_TTL_MS);
    expect((await rowFor(token))?.expiresAt.getTime()).toBe(extended.getTime());

    h.redis = new FakeRedis(); // force a DB read
    setClockForTests(new Date(NOW.getTime() + 20 * DAY + 3 * 60 * 60 * 1000));
    await getCurrentUser();
    expect((await rowFor(token))?.expiresAt.getTime()).toBe(extended.getTime());
    expect(tokenHash).toBe(sha256(token));
  });

  it("does not extend a session with 15 or more days left", async () => {
    const userId = await makeUser("noslide");
    await createSession(userId);
    const token = cookieToken();
    setClockForTests(new Date(NOW.getTime() + 10 * DAY));
    await getCurrentUser();
    expect((await rowFor(token))?.expiresAt.getTime()).toBe(NOW.getTime() + SESSION_TTL_MS);
  });

  it("writes last_seen_at only when the stored value is older than 5 minutes", async () => {
    const userId = await makeUser("seen");
    await createSession(userId);
    const token = cookieToken();
    expect((await rowFor(token))?.lastSeenAt).toBeNull();

    await getCurrentUser();
    expect((await rowFor(token))?.lastSeenAt?.getTime()).toBe(NOW.getTime());

    h.redis = new FakeRedis();
    setClockForTests(new Date(NOW.getTime() + 4 * 60_000));
    await getCurrentUser();
    expect((await rowFor(token))?.lastSeenAt?.getTime()).toBe(NOW.getTime());

    h.redis = new FakeRedis();
    setClockForTests(new Date(NOW.getTime() + 6 * 60_000));
    await getCurrentUser();
    expect((await rowFor(token))?.lastSeenAt?.getTime()).toBe(NOW.getTime() + 6 * 60_000);
  });
});

describe("invalidateUserSessions", () => {
  async function signInTwice(userId: string) {
    await createSession(userId);
    const first = cookieToken();
    await createSession(userId);
    const second = cookieToken();
    return { first, second };
  }

  it("deletes every row and cache key so a cached session is denied immediately", async () => {
    const userId = await makeUser("invalidate");
    const { first, second } = await signInTwice(userId);
    await getCurrentUser(); // caches `second`
    h.store.jar.set("__Host-session", first);
    await getCurrentUser(); // caches `first`
    expect(redis().values.size).toBe(2);

    await invalidateUserSessions(userId);

    expect(await rowFor(first)).toBeUndefined();
    expect(await rowFor(second)).toBeUndefined();
    expect(redis().values.size).toBe(0);
    await expect(getCurrentUser()).resolves.toBeNull();
    h.store.jar.set("__Host-session", second);
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("keeps the excepted session signed in", async () => {
    const userId = await makeUser("except");
    const { first, second } = await signInTwice(userId);
    await getCurrentUser();
    h.store.jar.set("__Host-session", first);
    await getCurrentUser();

    await invalidateUserSessions(userId, { exceptTokenHash: sha256(second) });

    expect(await rowFor(first)).toBeUndefined();
    expect(await rowFor(second)).toBeDefined();
    expect(redis().values.has(`sess:${sha256(first)}`)).toBe(false);
    expect(redis().values.has(`sess:${sha256(second)}`)).toBe(true);
    await expect(getCurrentUser()).resolves.toBeNull();
    h.store.jar.set("__Host-session", second);
    await expect(getCurrentUser()).resolves.toMatchObject({ id: userId });
  });

  it("does not touch another user's sessions", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    await createSession(a);
    await createSession(b);
    const bToken = cookieToken();
    await invalidateUserSessions(a);
    expect(await rowFor(bToken)).toBeDefined();
  });

  it("still deletes rows when Redis is unreachable", async () => {
    const userId = await makeUser("redisdown");
    await createSession(userId);
    const token = cookieToken();
    redis().failing = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await invalidateUserSessions(userId);
    expect(await rowFor(token)).toBeUndefined();
  });
});

describe("suspended users and no Redis", () => {
  it("rejects a suspended user on a DB read and on a cached read", async () => {
    const userId = await makeUser("suspend");
    await createSession(userId);
    await expect(getCurrentUser()).resolves.toMatchObject({ id: userId });

    await db().update(users).set({ status: "suspended" }).where(eq(users.id, userId));
    // Cached entry still says active until suspension invalidates it.
    await invalidateUserSessions(userId);
    await expect(getCurrentUser()).resolves.toBeNull();

    const suspendedId = await makeUser("suspended-from-start", "suspended");
    await createSession(suspendedId);
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("works from the DB alone when Redis is not configured", async () => {
    h.redis = null;
    const userId = await makeUser("noredis");
    await createSession(userId);
    await expect(getCurrentUser()).resolves.toMatchObject({ id: userId });
    await invalidateUserSessions(userId);
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
