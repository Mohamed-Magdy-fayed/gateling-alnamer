import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/server/auth/password";
import { setClockForTests } from "@/server/clock";
import { preSessions, users } from "@/server/db/schema";
import { FakeCookieStore } from "../../../test/fake-cookies";

const h = vi.hoisted(() => ({ store: null as unknown as FakeCookieStore }));

vi.mock("next/headers", () => ({ cookies: async () => h.store }));
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
const { issuePreSession, getPreSession, clearPreSession, PRE_SESSION_COOKIE } = await import(
  "./pre-session"
);

const db = () =>
  dbModule.db() as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
    typeof import("@/server/db/schema")
  >;

const NOW = new Date("2030-03-01T09:00:00.000Z");
const MIN = 60_000;

async function makeUser(label: string) {
  const [user] = await db()
    .insert(users)
    .values({ name: label, email: `${label}-${crypto.randomUUID()}@example.test` })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  return user.id;
}

const rowsFor = (userId: string) =>
  db().select().from(preSessions).where(eq(preSessions.userId, userId));

beforeEach(() => {
  setClockForTests(NOW);
  h.store = new FakeCookieStore();
});

afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("pre-session", () => {
  it("issues a hashed 15-minute row and a Path=/devices strict http-only cookie", async () => {
    const userId = await makeUser("ps1");
    const deviceKey = crypto.randomUUID();
    await issuePreSession(userId, deviceKey, { secure: true });

    const write = h.store.lastWrite(PRE_SESSION_COOKIE);
    expect(PRE_SESSION_COOKIE).toBe("presession");
    expect(write?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/devices",
    });
    const token = write?.value ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await db()
      .select()
      .from(preSessions)
      .where(eq(preSessions.tokenHash, sha256(token)));
    expect(row).toMatchObject({ userId, deviceKey });
    expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + 15 * MIN);
    expect(row?.tokenHash).not.toBe(token);
  });

  it("is not Secure over plain http", async () => {
    const userId = await makeUser("ps2");
    await issuePreSession(userId, crypto.randomUUID(), { secure: false });
    expect(h.store.lastWrite(PRE_SESSION_COOKIE)?.options).toMatchObject({ secure: false });
  });

  it("getPreSession returns the user and device key, then null after expiry", async () => {
    const userId = await makeUser("ps3");
    const deviceKey = crypto.randomUUID();
    await issuePreSession(userId, deviceKey, { secure: true });
    expect(await getPreSession()).toMatchObject({ userId, deviceKey });

    setClockForTests(new Date(NOW.getTime() + 15 * MIN + 1));
    expect(await getPreSession()).toBeNull();
  });

  it("returns null for a missing or unknown cookie", async () => {
    expect(await getPreSession()).toBeNull();
    h.store.jar.set(PRE_SESSION_COOKIE, "not-a-token");
    expect(await getPreSession()).toBeNull();
  });

  it("a new pre-session replaces the user's earlier one; clear removes row and cookie", async () => {
    const userId = await makeUser("ps4");
    await issuePreSession(userId, crypto.randomUUID(), { secure: true });
    await issuePreSession(userId, crypto.randomUUID(), { secure: true });
    expect(await rowsFor(userId)).toHaveLength(1);
    await clearPreSession();
    expect(await getPreSession()).toBeNull();
    expect(await rowsFor(userId)).toHaveLength(0);
    expect(h.store.lastWrite(PRE_SESSION_COOKIE)?.options).toMatchObject({
      path: "/devices",
      maxAge: 0,
    });
  });
});
