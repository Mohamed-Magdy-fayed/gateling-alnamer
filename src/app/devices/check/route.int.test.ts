import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/server/auth/password";
import { setClockForTests } from "@/server/clock";
import { devices, platformSettings, preSessions, sessions, users } from "@/server/db/schema";
import { FakeCookieStore } from "../../../../test/fake-cookies";

const h = vi.hoisted(() => ({ store: null as unknown as FakeCookieStore, key: "" }));

vi.mock("next/headers", () => ({ cookies: async () => h.store }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/auth/request-context", () => ({
  requestContext: async () => ({
    ip: "local",
    deviceId: h.key,
    deviceKey: h.key,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0",
    secure: false,
  }),
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 6, onnotice: () => {} });
  const conn = drizzle(client, { schema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => ReturnType<typeof import("drizzle-orm/postgres-js").drizzle>;
  closeTestDb: () => Promise<void>;
};
const { GET } = await import("./route");
const { registerOrBlock } = await import("@/server/devices/service");

const db = () =>
  dbModule.db() as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
    typeof import("@/server/db/schema")
  >;

const NOW = new Date("2030-03-01T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

async function makeUser(label: string, role: "student" | "teacher" = "student") {
  const [user] = await db()
    .insert(users)
    .values({ name: label, email: `${label}-${crypto.randomUUID()}@example.test`, role })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  return user.id;
}

/** A session row (no device unless given) with its cookie in the fake jar. */
async function signedIn(userId: string, deviceId: string | null = null) {
  const token = `tok-${crypto.randomUUID()}`;
  await db()
    .insert(sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      deviceId,
      expiresAt: new Date(NOW.getTime() + DAY),
    });
  h.store.jar.set("__Host-session", token);
  return sha256(token);
}

/** A same-origin navigation by default; pass headers to model another kind of request. */
async function call(
  next?: string,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
): Promise<string> {
  const url = new URL("http://localhost/devices/check");
  if (next !== undefined) url.searchParams.set("next", next);
  try {
    await GET({ nextUrl: url, headers: new Headers(headers) } as never);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) {
      return error.message.slice("redirect:".length);
    }
    throw error;
  }
  throw new Error("route did not redirect");
}

async function sessionRow(tokenHash: string) {
  const [row] = await db().select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
  return row;
}

beforeEach(async () => {
  setClockForTests(NOW);
  h.store = new FakeCookieStore();
  h.key = crypto.randomUUID();
  await db()
    .update(platformSettings)
    .set({ deviceLimit: 1, deviceLimitMode: "strict" })
    .where(eq(platformSettings.id, 1));
});

afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("GET /devices/check", () => {
  it("attaches the device to a legacy session and returns to `next`", async () => {
    const userId = await makeUser("c1");
    const token = await signedIn(userId);
    expect(await call("/dashboard/learn/abc")).toBe("/dashboard/learn/abc");
    const row = await sessionRow(token);
    const [device] = await db().select().from(devices).where(eq(devices.userId, userId));
    expect(row?.deviceId).toBeTruthy();
    expect(row?.deviceId).toBe(device?.id);
    expect(device?.deviceKey).toBe(h.key);
  });

  it("on block destroys the session, issues a pre-session and goes to /devices/blocked", async () => {
    const userId = await makeUser("c2");
    await registerOrBlock(userId, crypto.randomUUID(), null); // the one allowed slot is taken
    const token = await signedIn(userId);
    expect(await call("/dashboard/learn/abc")).toBe("/devices/blocked");
    expect(await sessionRow(token)).toBeUndefined();
    expect(h.store.lastWrite("presession")?.options).toMatchObject({ path: "/devices" });
    const pre = await db().select().from(preSessions).where(eq(preSessions.userId, userId));
    expect(pre).toHaveLength(1);
    expect(pre[0]?.deviceKey).toBe(h.key);
  });

  it("re-registers a session whose device was revoked", async () => {
    const userId = await makeUser("c3");
    const first = await registerOrBlock(userId, h.key, null);
    const token = await signedIn(userId, first.deviceId);
    await db()
      .update(devices)
      .set({ revokedAt: NOW, revokedReason: "admin" })
      .where(eq(devices.userId, userId));
    expect(await call("/dashboard")).toBe("/dashboard");
    const row = await sessionRow(token);
    expect(row?.deviceId).toBeTruthy();
    expect(row?.deviceId).not.toBe(first.deviceId);
  });

  it("does nothing for a session whose device is already active", async () => {
    const userId = await makeUser("c4");
    const first = await registerOrBlock(userId, h.key, null);
    await signedIn(userId, first.deviceId);
    expect(await call("/dashboard/x")).toBe("/dashboard/x");
    expect(await db().select().from(devices).where(eq(devices.userId, userId))).toHaveLength(1);
  });

  it("passes non-students straight through without registering a device", async () => {
    const userId = await makeUser("c5", "teacher");
    await signedIn(userId);
    expect(await call("/dashboard")).toBe("/dashboard");
    expect(await db().select().from(devices).where(eq(devices.userId, userId))).toHaveLength(0);
  });

  it("sends a signed-out request to sign-in", async () => {
    expect(await call("/dashboard")).toBe("/sign-in");
  });

  it.each([
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    undefined,
  ])("never redirects to %j", async (next) => {
    const userId = await makeUser("c6");
    await signedIn(userId);
    expect(await call(next)).toBe("/dashboard");
  });

  it("a pre-session cookie alone is signed out", async () => {
    h.store.jar.set("presession", "something");
    expect(await call("/dashboard")).toBe("/sign-in");
  });

  describe("cross-site requests", () => {
    it.each([
      ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
      ["a same-site sibling", { "sec-fetch-site": "same-site" }],
      ["no fetch metadata and a foreign referer", { referer: "https://evil.example/x" }],
      ["neither header", {}],
    ])("%s changes nothing and goes to /dashboard", async (_name, headers) => {
      const userId = await makeUser("x1");
      const token = await signedIn(userId);
      expect(await call("/dashboard/learn/abc", headers)).toBe("/dashboard");
      expect((await sessionRow(token))?.deviceId).toBeNull();
      expect(await db().select().from(devices).where(eq(devices.userId, userId))).toHaveLength(0);
    });

    it.each([
      ["a typed address (none)", { "sec-fetch-site": "none" }],
      ["no fetch metadata and our own referer", { referer: "http://localhost/dashboard/x" }],
    ])("proceeds for %s", async (_name, headers) => {
      const userId = await makeUser("x2");
      await signedIn(userId);
      expect(await call("/dashboard/learn/abc", headers)).toBe("/dashboard/learn/abc");
      expect(await db().select().from(devices).where(eq(devices.userId, userId))).toHaveLength(1);
    });
  });
});
