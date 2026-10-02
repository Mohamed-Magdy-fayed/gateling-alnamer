import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { devices, sessions, users } from "@/server/db/schema";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("../client", () => ({ inngest: { createFunction: vi.fn() } }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  const conn = drizzle(client, { schema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => ReturnType<typeof import("drizzle-orm/postgres-js").drizzle>;
  closeTestDb: () => Promise<void>;
};
const { handleExpireDevices } = await import("./expire-devices");

const db = () =>
  dbModule.db() as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
    typeof import("@/server/db/schema")
  >;

const NOW = new Date("2030-04-01T01:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

async function makeStudent() {
  const [user] = await db()
    .insert(users)
    .values({ name: "Exp", email: `exp-${crypto.randomUUID()}@example.test`, role: "student" })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  return user.id;
}

async function makeDevice(userId: string, idleDays: number) {
  const [device] = await db()
    .insert(devices)
    .values({
      userId,
      deviceKey: crypto.randomUUID(),
      label: "Chrome on Windows",
      firstSeenAt: new Date(NOW.getTime() - 60 * DAY),
      lastSeenAt: new Date(NOW.getTime() - idleDays * DAY),
    })
    .returning({ id: devices.id });
  if (!device) throw new Error("no device");
  const tokenHash = crypto.randomUUID();
  await db()
    .insert(sessions)
    .values({ tokenHash, userId, deviceId: device.id, expiresAt: new Date(NOW.getTime() + DAY) });
  return { id: device.id, tokenHash };
}

const deviceRow = async (id: string) =>
  (await db().select().from(devices).where(eq(devices.id, id)))[0];
const sessionCount = async (tokenHash: string) =>
  (await db().select().from(sessions).where(eq(sessions.tokenHash, tokenHash))).length;

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("handleExpireDevices", () => {
  it("revokes only devices idle over 30 days with reason expired and deletes their sessions", async () => {
    const userId = await makeStudent();
    const stale = await makeDevice(userId, 31);
    const edge = await makeDevice(userId, 29);

    expect(await handleExpireDevices()).toBeGreaterThanOrEqual(1);

    const staleRow = await deviceRow(stale.id);
    expect(staleRow?.revokedReason).toBe("expired");
    expect(staleRow?.revokedAt).toEqual(NOW);
    expect(await sessionCount(stale.tokenHash)).toBe(0);

    const edgeRow = await deviceRow(edge.id);
    expect(edgeRow?.revokedAt).toBeNull();
    expect(await sessionCount(edge.tokenHash)).toBe(1);
  });

  it("is idempotent: a retry revokes nothing more", async () => {
    const userId = await makeStudent();
    const stale = await makeDevice(userId, 45);
    await handleExpireDevices();
    const first = await deviceRow(stale.id);
    setClockForTests(new Date(NOW.getTime() + DAY));
    await handleExpireDevices();
    const second = await deviceRow(stale.id);
    expect(second?.revokedAt).toEqual(first?.revokedAt);
    expect(second?.revokedReason).toBe("expired");
  });
});
