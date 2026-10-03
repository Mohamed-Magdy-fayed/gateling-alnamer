import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { parentLinks, users } from "@/server/db/schema";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/auth/session", () => ({
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("@/server/auth/request-context", () => ({
  requestContext: vi.fn(async () => ({ ip: "9.9.9.9", deviceId: null })),
}));
vi.mock("@/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));
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
type Role = "student" | "parent";
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
      name: `${role} user`,
      email: `${role}-${crypto.randomUUID()}@example.test`,
      role,
      emailVerifiedAt: NOW,
      dateOfBirth: role === "parent" ? "1985-01-01" : "2015-01-01",
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
const as = (user: TestUser) => createCallerFactory(appRouter)({ user, headers: HEADERS });

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("parent and student link procedures", () => {
  it("invites.create returns the code once; invites.list never contains it", async () => {
    const parent = await makeUser("parent");
    const created = await as(parent).parent.invites.create();
    expect(created.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(Object.keys(created).sort()).toEqual(["code", "expiresAt"]);
    expect(created.expiresAt.getTime()).toBe(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

    const listed = await as(parent).parent.invites.list();
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(["expiresAt", "id"]);
    expect(JSON.stringify(listed)).not.toContain(created.code.replace("-", ""));
    expect(JSON.stringify(listed)).not.toContain(created.code);
  });

  it("creates a child with a pinned card shape and no extra fields", async () => {
    const parent = await makeUser("parent");
    const out = await as(parent).parent.children.create({
      name: "Sara Ali",
      username: `sara_${Math.floor(Math.random() * 1e6)}`,
      password: "a-long-password-1",
      dateOfBirth: "2015-03-04",
    });
    expect(Object.keys(out)).toEqual(["childId"]);
    const [card] = await as(parent).parent.children.list();
    expect(Object.keys(card ?? {}).sort()).toEqual([
      "ageYears",
      "childId",
      "createdAt",
      "displayName",
      "maskedEmail",
      "source",
      "username",
    ]);
    expect(card?.maskedEmail).toBeNull();
  });

  it("redeem links a student; list shows the parent masked; unlink removes it", async () => {
    const parent = await makeUser("parent");
    const student = await makeUser("student");
    const { code } = await as(parent).parent.invites.create();

    await expect(as(student).student.parentLinks.redeem({ code })).resolves.toEqual({
      linked: true,
    });
    const parents = await as(student).student.parentLinks.list();
    expect(parents).toHaveLength(1);
    expect(Object.keys(parents[0] ?? {}).sort()).toEqual([
      "displayName",
      "maskedEmail",
      "parentId",
      "source",
    ]);
    expect(parents[0]?.maskedEmail).not.toContain(parent.email);

    await as(student).student.parentLinks.unlink({ parentId: parent.id });
    expect(await db().select().from(parentLinks)).not.toContainEqual(
      expect.objectContaining({ studentId: student.id }),
    );
  });

  it("a wrong code is BAD_REQUEST and a parent cannot unlink an unrelated student", async () => {
    const student = await makeUser("student");
    await expect(
      as(student).student.parentLinks.redeem({ code: "ZZZZ-ZZZZ" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const parent = await makeUser("parent");
    await expect(as(parent).parent.children.unlink({ childId: student.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
