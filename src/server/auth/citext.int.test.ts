import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { users } from "@/server/db/schema";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} });
const db = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

const prestepStatements = readFileSync(
  "src/server/db/migrations/0012_citext_prestep.sql",
  "utf8",
).split("--> statement-breakpoint");

// The pre-step runs on the old shape (plain text emails), so rehearse it in a scratch schema.
async function runPrestep(emails: string[]): Promise<{ error: string | null; emails: string[] }> {
  return client.begin(async (tx) => {
    await tx.unsafe("create temp table users (email text unique) on commit drop");
    for (const email of emails) await tx`insert into users (email) values (${email})`;
    let error: string | null = null;
    try {
      await tx.savepoint(async (sp) => {
        for (const statement of prestepStatements) await sp.unsafe(statement);
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const rows = await tx<{ email: string }[]>`select email from users order by email`;
    return { error, emails: rows.map((r) => r.email) };
  });
}

describe("citext pre-step", () => {
  it("raises when two emails differ only by case, reporting a count and no address", async () => {
    const { error } = await runPrestep([
      "Dup@Example.test",
      "dup@example.test",
      "other@example.test",
    ]);
    expect(error).not.toBeNull();
    expect(error).toMatch(/\b1\b/);
    expect(error?.toLowerCase()).not.toContain("example.test");
    expect(error).not.toContain("@");
  });

  it("lower-cases mixed-case emails when there are no collisions", async () => {
    const { error, emails } = await runPrestep(["Mixed.Case@Example.test", "plain@example.test"]);
    expect(error).toBeNull();
    expect(emails).toEqual(["mixed.case@example.test", "plain@example.test"]);
  });
});

describe("case-insensitive email and username", () => {
  it("finds a user by email in any case", async () => {
    await db.insert(users).values({ name: "C", email: "Case.Lookup@Example.test" });
    const found = await db.query.users.findFirst({
      where: eq(users.email, "CASE.lookup@example.TEST"),
    });
    expect(found?.email).toBe("Case.Lookup@Example.test");
  });

  it("rejects a case-variant duplicate email on the unique constraint", async () => {
    await db.insert(users).values({ name: "D1", email: "dupe.row@example.test" });
    await expect(
      db.insert(users).values({ name: "D2", email: "DUPE.ROW@example.test" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("keeps usernames unique case-insensitively", async () => {
    await db.insert(users).values({ name: "U1", username: "sara.m" });
    await expect(db.insert(users).values({ name: "U2", username: "sara.m" })).rejects.toMatchObject(
      {
        cause: { code: "23505" },
      },
    );
    const found = await db.query.users.findFirst({ where: eq(users.username, "SARA.M") });
    expect(found?.name).toBe("U1");
  });

  it.each(["ab", "x".repeat(21), "has space", "dash-ed"])(
    "rejects username %j through the CHECK constraint",
    async (username) => {
      await expect(db.insert(users).values({ name: "Bad", username })).rejects.toMatchObject({
        cause: { code: "23514" },
      });
    },
  );

  it("accepts upper-case input that is valid once lower-cased", async () => {
    const [u] = await db.insert(users).values({ name: "Up", username: "Mixed_Ok9" }).returning();
    expect(u?.username).toBe("Mixed_Ok9");
  });
});
