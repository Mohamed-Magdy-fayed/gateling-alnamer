import { asc, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { sessions, users } from "@/server/db/schema";
import { nextPublicNumber } from "./public-number";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} });
const db = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

describe("public number backfill", () => {
  it("numbers every migrated user uniquely, in created_at order, from AN100001", async () => {
    // The sample catalogue migration inserted users before the backfill ran.
    const rows = await db
      .select({ publicNumber: users.publicNumber })
      .from(users)
      .where(isNotNull(users.publicNumber))
      .orderBy(asc(users.createdAt), asc(users.id));
    expect(rows.length).toBeGreaterThan(0);
    const numbers = rows.map((r) => r.publicNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers[0]).toBe("AN100001");
    numbers.forEach((n) => {
      expect(n).toMatch(/^AN\d{6}$/);
    });
    const nulls = await db.select().from(users).where(eq(users.publicNumber, ""));
    expect(nulls).toHaveLength(0);
  });

  it("lets a new user take the next number from the sequence", async () => {
    const number = await db.transaction((tx) => nextPublicNumber(tx));
    expect(number).toMatch(/^AN\d{6}$/);
    const [created] = await db
      .insert(users)
      .values({ name: "N", email: "seq@example.test", publicNumber: number })
      .returning({ publicNumber: users.publicNumber });
    expect(created?.publicNumber).toBe(number);
    const second = await db.transaction((tx) => nextPublicNumber(tx));
    expect(Number(second.slice(2))).toBe(Number(number.slice(2)) + 1);
  });
});

describe("identity columns", () => {
  it("accepts the reviewer role and defaults status and is_super_admin", async () => {
    const [u] = await db
      .insert(users)
      .values({ name: "R", email: "reviewer@example.test", role: "reviewer" })
      .returning();
    expect(u?.role).toBe("reviewer");
    expect(u?.status).toBe("active");
    expect(u?.isSuperAdmin).toBe(false);
    expect(u?.publicNumber).toBeNull();
    expect(u?.dateOfBirth).toBeNull();
    expect(u?.guardianConsentAt).toBeNull();
    expect(u?.locale).toBeNull();
  });

  it("defaults the new session columns", async () => {
    const [u] = await db
      .insert(users)
      .values({ name: "S", email: "sess@example.test" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    const [s] = await db
      .insert(sessions)
      .values({ tokenHash: "h-identity", userId: u.id, expiresAt: new Date(Date.now() + 60_000) })
      .returning();
    expect(s?.twoFactorVerified).toBe(false);
    expect(s?.deviceId).toBeNull();
    expect(s?.lastSeenAt).toBeNull();
  });
});
