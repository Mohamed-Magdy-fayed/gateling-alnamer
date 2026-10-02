import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { credentials, users } from "@/server/db/schema";
import { authenticate } from "./credentials";
import { generateSalt, hashLegacyScrypt, hashPassword } from "./password";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} });
const conn = drizzle(client, { schema });
const db = () => conn;

afterAll(async () => {
  await client.end();
});

async function createUser(email: string, credential: { hash: string; salt: string | null }) {
  const [user] = await db().insert(users).values({ name: "T", email }).returning({ id: users.id });
  if (!user) throw new Error("no user");
  await db()
    .insert(credentials)
    .values({ userId: user.id, passwordHash: credential.hash, passwordSalt: credential.salt });
  return user.id;
}

async function readCredential(userId: string) {
  const [row] = await db().select().from(credentials).where(eq(credentials.userId, userId));
  return row;
}

describe("authenticate", () => {
  it("signs in a credential written the old way and rehashes it to argon2id", async () => {
    const salt = generateSalt();
    const userId = await createUser("legacy@example.test", {
      hash: await hashLegacyScrypt("old password 1", salt),
      salt,
    });

    expect(await authenticate("legacy@example.test", "old password 1", conn)).toBe(userId);

    const row = await readCredential(userId);
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordSalt).toBeNull();
    // The new hash keeps working, now through the argon2 path.
    expect(await authenticate("legacy@example.test", "old password 1", conn)).toBe(userId);
  });

  it("does not touch a legacy credential on a wrong password", async () => {
    const salt = generateSalt();
    const hash = await hashLegacyScrypt("old password 2", salt);
    const userId = await createUser("legacy2@example.test", { hash, salt });

    expect(await authenticate("legacy2@example.test", "nope nope nope", conn)).toBeNull();

    const row = await readCredential(userId);
    expect(row?.passwordHash).toBe(hash);
    expect(row?.passwordSalt).toBe(salt);
  });

  it("signs in an argon2id credential with a null salt", async () => {
    const userId = await createUser("modern@example.test", {
      hash: await hashPassword("new password 1"),
      salt: null,
    });
    expect(await authenticate("modern@example.test", "new password 1", conn)).toBe(userId);
    expect(await authenticate("modern@example.test", "wrong password", conn)).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    expect(await authenticate("nobody@example.test", "whatever password", conn)).toBeNull();
  });
});

describe("authenticate by username", () => {
  it("treats an identifier without @ as a username (trimmed, any case)", async () => {
    const [user] = await db()
      .insert(users)
      .values({ name: "U", email: "byname@example.test", username: "by.name" })
      .returning({ id: users.id });
    if (!user) throw new Error("no user");
    await db()
      .insert(credentials)
      .values({ userId: user.id, passwordHash: await hashPassword("user pass 123") });

    expect(await authenticate(" By.Name ", "user pass 123", conn)).toBe(user.id);
    expect(await authenticate("BYNAME@example.test", "user pass 123", conn)).toBe(user.id);
    expect(await authenticate("by.name", "wrong pass 123", conn)).toBeNull();
    expect(await authenticate("no.such.user", "user pass 123", conn)).toBeNull();
    // An identifier without @ is never matched against the email column.
    expect(await authenticate("byname", "user pass 123", conn)).toBeNull();
  });
});
