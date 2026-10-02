import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { devices, platformSettings, preSessions, sessions, users } from "@/server/db/schema";
import { FakeCookieStore } from "../../../test/fake-cookies";

const h = vi.hoisted(() => ({ store: null as unknown as FakeCookieStore }));

vi.mock("next/headers", () => ({ cookies: async () => h.store }));
vi.mock("@/server/redis", () => ({ getRedis: () => null }));
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
const { gateDevice } = await import("./sign-in");

const db = () =>
  dbModule.db() as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
    typeof import("@/server/db/schema")
  >;

const NOW = new Date("2030-03-01T09:00:00.000Z");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0";
const ctx = () => ({ deviceKey: crypto.randomUUID(), userAgent: UA, secure: false });

async function makeUser(label: string, role: "student" | "admin" | "parent" = "student") {
  const [user] = await db()
    .insert(users)
    .values({ name: label, email: `${label}-${crypto.randomUUID()}@example.test`, role })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  return user.id;
}

async function setSettings(limit: number, mode: "strict" | "soft") {
  await db()
    .update(platformSettings)
    .set({ deviceLimit: limit, deviceLimitMode: mode })
    .where(eq(platformSettings.id, 1));
}

const deviceRows = (userId: string) =>
  db().select().from(devices).where(eq(devices.userId, userId));

beforeEach(async () => {
  setClockForTests(NOW);
  h.store = new FakeCookieStore();
  await setSettings(1, "strict");
});

afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("gateDevice", () => {
  it("registers a student's first device and returns its id", async () => {
    const userId = await makeUser("g1");
    const result = await gateDevice(userId, ctx());
    expect(result).toMatchObject({ kind: "allowed", overLimit: false });
    const rows = await deviceRows(userId);
    expect(rows).toHaveLength(1);
    expect(result.kind === "allowed" && result.deviceId).toBe(rows[0]?.id);
  });

  it("recognises a returning key without a new row", async () => {
    const userId = await makeUser("g2");
    const c = ctx();
    await gateDevice(userId, c);
    expect(await gateDevice(userId, c)).toMatchObject({ kind: "allowed", overLimit: false });
    expect(await deviceRows(userId)).toHaveLength(1);
  });

  it("blocks a second device in strict mode: pre-session issued, no session, no device", async () => {
    const userId = await makeUser("g3");
    await gateDevice(userId, ctx());
    const second = ctx();
    expect(await gateDevice(userId, second)).toEqual({ kind: "blocked" });
    const pre = await db().select().from(preSessions).where(eq(preSessions.userId, userId));
    expect(pre).toHaveLength(1);
    expect(pre[0]?.deviceKey).toBe(second.deviceKey);
    expect(h.store.lastWrite("presession")?.options).toMatchObject({
      path: "/devices",
      sameSite: "strict",
    });
    expect(await db().select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
    expect(await deviceRows(userId)).toHaveLength(1);
  });

  it("soft mode allows the second device and flags it as over the limit", async () => {
    await setSettings(1, "soft");
    const userId = await makeUser("g4");
    await gateDevice(userId, ctx());
    expect(await gateDevice(userId, ctx())).toMatchObject({ kind: "allowed", overLimit: true });
    expect(
      await db().select().from(preSessions).where(eq(preSessions.userId, userId)),
    ).toHaveLength(0);
  });

  it("registers nothing for non-students", async () => {
    const admin = await makeUser("g5", "admin");
    const parent = await makeUser("g6", "parent");
    for (const id of [admin, parent]) {
      expect(await gateDevice(id, ctx())).toEqual({
        kind: "allowed",
        deviceId: null,
        overLimit: false,
      });
      expect(await deviceRows(id)).toHaveLength(0);
    }
  });
});
