import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { auditLog, deviceRemovals, devices, sessions, users } from "@/server/db/schema";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/auth/session", () => ({
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example" }),
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", {
    max: 4,
    onnotice: () => {},
  });
  const conn = drizzle(client, { schema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => ReturnType<typeof import("drizzle-orm/postgres-js").drizzle>;
  closeTestDb: () => Promise<void>;
};
const { appRouter } = await import("../root");
const { createCallerFactory } = await import("../trpc");

const db = () =>
  dbModule.db() as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
    typeof import("@/server/db/schema")
  >;

const NOW = new Date("2030-05-01T09:00:00.000Z");
const HEADERS = new Headers({
  origin: "https://alnamer.example",
  host: "alnamer.example",
});

type Role = "student" | "admin" | "parent";
type TestUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active";
};

async function makeUser(role: Role): Promise<TestUser> {
  const [user] = await db()
    .insert(users)
    .values({
      name: role,
      email: `${role}-${crypto.randomUUID()}@example.test`,
      role,
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
    });
  if (!user) throw new Error("no user");
  return user as TestUser;
}

const callerAs = (user: TestUser | null) =>
  createCallerFactory(appRouter)({ user, headers: HEADERS });

async function addDevice(userId: string) {
  const [device] = await db()
    .insert(devices)
    .values({
      userId,
      deviceKey: crypto.randomUUID(),
      label: "Chrome on Windows",
    })
    .returning({ id: devices.id });
  if (!device) throw new Error("no device");
  const tokenHash = crypto.randomUUID();
  await db()
    .insert(sessions)
    .values({
      tokenHash,
      userId,
      deviceId: device.id,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
  return { id: device.id, tokenHash };
}

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("admin.devices.reset", () => {
  it("rejects anonymous (UNAUTHORIZED) and non-admin (FORBIDDEN) callers and changes nothing", async () => {
    const student = await makeUser("student");
    const target = await makeUser("student");
    const d = await addDevice(target.id);
    await expect(callerAs(null).admin.devices.reset({ userId: target.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      callerAs(student).admin.devices.reset({ userId: target.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [row] = await db().select().from(devices).where(eq(devices.id, d.id));
    expect(row?.revokedAt).toBeNull();
  });

  it("rejects a mutation without a matching Origin", async () => {
    const admin = await makeUser("admin");
    const target = await makeUser("student");
    const bare = createCallerFactory(appRouter)({ user: admin });
    await expect(bare.admin.devices.reset({ userId: target.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("revokes devices, deletes sessions, writes admin removals and the audit row", async () => {
    const admin = await makeUser("admin");
    const target = await makeUser("student");
    const a = await addDevice(target.id);
    await addDevice(target.id);

    await expect(callerAs(admin).admin.devices.reset({ userId: target.id })).resolves.toEqual({
      revoked: 2,
    });
    const rows = await db().select().from(devices).where(eq(devices.userId, target.id));
    expect(rows.every((d) => d.revokedReason === "admin" && d.revokedAt)).toBe(true);
    expect(
      await db().select().from(sessions).where(eq(sessions.tokenHash, a.tokenHash)),
    ).toHaveLength(0);
    const removals = await db()
      .select()
      .from(deviceRemovals)
      .where(and(eq(deviceRemovals.userId, target.id), eq(deviceRemovals.kind, "admin")));
    expect(removals).toHaveLength(2);
    expect(removals.every((r) => r.actorId === admin.id)).toBe(true);
    const audit = await db().select().from(auditLog).where(eq(auditLog.subjectId, target.id));
    expect(audit.filter((x) => x.action === "device.reset" && x.actorId === admin.id)).toHaveLength(
      1,
    );
  });

  it("rejects a target that is not a student, or does not exist, with BAD_REQUEST", async () => {
    const admin = await makeUser("admin");
    const parent = await makeUser("parent");
    await expect(callerAs(admin).admin.devices.reset({ userId: parent.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      callerAs(admin).admin.devices.reset({ userId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
