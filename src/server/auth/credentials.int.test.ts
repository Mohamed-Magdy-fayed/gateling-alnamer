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

async function createUserWithStatus(email: string, status: "active" | "suspended", hash: string) {
  const [user] = await db()
    .insert(users)
    .values({ name: "T", email, status })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  await db()
    .insert(credentials)
    .values({ userId: user.id, passwordHash: hash, passwordSalt: null });
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

describe("authenticate account status", () => {
  it("returns null for a suspended user even with the right password", async () => {
    const hash = await hashPassword("suspended pass 1");
    await createUserWithStatus("suspended@example.test", "suspended", hash);
    expect(await authenticate("suspended@example.test", "suspended pass 1", conn)).toBeNull();
    expect(await authenticate("suspended@example.test", "wrong pass 1", conn)).toBeNull();
  });

  it("does not rehash a suspended user's legacy credential", async () => {
    const salt = generateSalt();
    const hash = await hashLegacyScrypt("legacy susp 1", salt);
    const [user] = await db()
      .insert(users)
      .values({ name: "T", email: "legacy-susp@example.test", status: "suspended" })
      .returning({ id: users.id });
    if (!user) throw new Error("no user");
    await db()
      .insert(credentials)
      .values({ userId: user.id, passwordHash: hash, passwordSalt: salt });
    expect(await authenticate("legacy-susp@example.test", "legacy susp 1", conn)).toBeNull();
    expect((await readCredential(user.id))?.passwordHash).toBe(hash);
  });
});

describe("authenticate rehash race", () => {
  it("does not overwrite a password reset that lands between verify and rehash", async () => {
    const salt = generateSalt();
    const userId = await createUser("race@example.test", {
      hash: await hashLegacyScrypt("race pass 1", salt),
      salt,
    });
    const resetHash = await hashPassword("reset by owner 1");

    // A reset commits right after authenticate has read the credential (before the rehash write).
    const racing = {
      query: {
        users: {
          findFirst: async (...args: Parameters<typeof conn.query.users.findFirst>) => {
            const found = await conn.query.users.findFirst(...args);
            await conn
              .update(credentials)
              .set({ passwordHash: resetHash, passwordSalt: null })
              .where(eq(credentials.userId, userId));
            return found;
          },
        },
      },
      update: conn.update.bind(conn),
    } as unknown as Parameters<typeof authenticate>[2];

    expect(await authenticate("race@example.test", "race pass 1", racing)).toBeNull();
    expect((await readCredential(userId))?.passwordHash).toBe(resetHash);
  });
});
