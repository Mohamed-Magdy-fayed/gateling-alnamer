import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 3, onnotice: () => {} });
  return { db: () => drizzle(client, { schema }), closeTestDb: () => client.end() };
});

const { db, closeTestDb } = await import("@/server/db");
const { sessions, users } = await import("@/server/db/schema");
const { upsertAccount } = await import("./lib/seed-accounts.mts");

afterAll(async () => {
  await closeTestDb();
});

const account = { name: "Demo Student", email: "seed-int@demo.alnamer.invalid", role: "student" };
const options = { password: "demo-pass-for-tests-1", isSample: true, refresh: true };

describe("upsertAccount with refresh", () => {
  it("signs the account out everywhere and never leaves a super admin", async () => {
    const first = await upsertAccount(db(), account, options);
    await db().update(users).set({ isSuperAdmin: true }).where(eq(users.id, first.userId));
    await db()
      .insert(sessions)
      .values([
        { tokenHash: "seed-int-a", userId: first.userId, expiresAt: new Date(Date.now() + 1e9) },
        { tokenHash: "seed-int-b", userId: first.userId, expiresAt: new Date(Date.now() + 1e9) },
      ]);

    const second = await upsertAccount(db(), account, options);

    expect(second.userId).toBe(first.userId);
    const left = await db().select().from(sessions).where(eq(sessions.userId, first.userId));
    expect(left).toHaveLength(0);
    const [user] = await db().select().from(users).where(eq(users.id, first.userId));
    expect(user?.isSuperAdmin).toBe(false);
    expect(user?.isSample).toBe(true);
  });

  it("keeps existing sessions when refresh is off (local seed)", async () => {
    const local = { ...account, email: "seed-int-local@demo.alnamer.invalid" };
    const first = await upsertAccount(db(), local, { ...options, refresh: false });
    await db()
      .insert(sessions)
      .values({
        tokenHash: "seed-int-c",
        userId: first.userId,
        expiresAt: new Date(Date.now() + 1e9),
      });
    await upsertAccount(db(), local, { ...options, refresh: false });
    const left = await db().select().from(sessions).where(eq(sessions.userId, first.userId));
    expect(left).toHaveLength(1);
  });
});
