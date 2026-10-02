import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { credentials, users } from "@/server/db/schema";
import { authenticate } from "./credentials";
import { signUpUser } from "./sign-up";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} });
const conn = drizzle(client, { schema });
afterAll(async () => {
  await client.end();
});

const NOW = new Date("2026-10-02T10:00:00Z");
const ctx = { locale: "en" as const, now: NOW };
let seq = 0;

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    name: "Test Person",
    email: `person${seq}@example.test`,
    password: "A-good-pass-1",
    role: "student",
    date_of_birth: "2000-01-01",
    ...over,
  };
}

async function row(email: string) {
  const [found] = await conn.select().from(users).where(eq(users.email, email));
  return found;
}

describe("signUpUser", () => {
  it("creates an adult student with a public number, locale, dob and argon2id", async () => {
    const input = base({ username: "Adult_One" });
    const result = await signUpUser(input, ctx, conn);
    expect(result.ok).toBe(true);
    const user = await row(String(input.email));
    expect(user?.role).toBe("student");
    expect(user?.username).toBe("adult_one");
    expect(user?.publicNumber).toMatch(/^AN\d{6}$/);
    expect(user?.locale).toBe("en");
    expect(user?.dateOfBirth).toBe("2000-01-01");
    expect(user?.guardianConsentAt).toBeNull();
    const [cred] = await conn
      .select()
      .from(credentials)
      .where(eq(credentials.userId, user?.id ?? ""));
    expect(cred?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("gives two sign-ups different public numbers", async () => {
    const a = base();
    const b = base();
    await signUpUser(a, ctx, conn);
    await signUpUser(b, ctx, conn);
    expect((await row(String(a.email)))?.publicNumber).not.toBe(
      (await row(String(b.email)))?.publicNumber,
    );
  });

  it("rejects a student under 18 without consent", async () => {
    const result = await signUpUser(base({ date_of_birth: "2012-06-01" }), ctx, conn);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(result.ok === false && result.fields).toContain("guardian_consent");
  });

  it("stores guardian_consent_at for a minor who ticks consent", async () => {
    const input = base({ date_of_birth: "2012-06-01", guardian_consent: "on" });
    expect((await signUpUser(input, ctx, conn)).ok).toBe(true);
    expect((await row(String(input.email)))?.guardianConsentAt?.toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  it("treats someone who turns 18 today as an adult, so consent is not allowed", async () => {
    const withConsent = base({ date_of_birth: "2008-10-02", guardian_consent: "on" });
    expect((await signUpUser(withConsent, ctx, conn)).ok).toBe(false);
    const plain = base({ date_of_birth: "2008-10-02" });
    expect((await signUpUser(plain, ctx, conn)).ok).toBe(true);
  });

  it("rejects an adult student who sets consent", async () => {
    const result = await signUpUser(base({ guardian_consent: "on" }), ctx, conn);
    expect(result.ok).toBe(false);
  });

  it("rejects a student without a date of birth, a future date and an impossible date", async () => {
    for (const date_of_birth of [undefined, "", "2030-01-01", "2010-02-30", "1930-01-01"]) {
      const result = await signUpUser(base({ date_of_birth }), ctx, conn);
      expect(result.ok, String(date_of_birth)).toBe(false);
      expect(result.ok === false && result.fields).toContain("date_of_birth");
    }
  });

  it("creates a parent without a date of birth and stores none", async () => {
    const input = base({ role: "parent", date_of_birth: undefined });
    expect((await signUpUser(input, ctx, conn)).ok).toBe(true);
    const user = await row(String(input.email));
    expect(user?.role).toBe("parent");
    expect(user?.dateOfBirth).toBeNull();
  });

  it("rejects teacher, admin and reviewer roles", async () => {
    for (const role of ["teacher", "admin", "reviewer"]) {
      expect((await signUpUser(base({ role }), ctx, conn)).ok, role).toBe(false);
    }
  });

  it("enforces username rules and the reserved list", async () => {
    for (const username of ["ab", "has space", "UPPER-dash", "admin", "ADMIN", "a".repeat(21)]) {
      const result = await signUpUser(base({ username }), ctx, conn);
      expect(result.ok, username).toBe(false);
      expect(result.ok === false && result.fields).toContain("username");
    }
  });

  it("answers a duplicate email and a duplicate username with the same generic result", async () => {
    const first = base({ username: "taken.name" });
    expect((await signUpUser(first, ctx, conn)).ok).toBe(true);
    const sameEmail = await signUpUser(
      base({ email: String(first.email).toUpperCase() }),
      ctx,
      conn,
    );
    const sameUsername = await signUpUser(base({ username: "TAKEN.name" }), ctx, conn);
    expect(sameEmail).toEqual({ ok: false, code: "duplicate", fields: [] });
    expect(sameUsername).toEqual(sameEmail);
  });

  it("rejects a short password and a bad email", async () => {
    expect((await signUpUser(base({ password: "short" }), ctx, conn)).ok).toBe(false);
    expect((await signUpUser(base({ email: "not-an-email" }), ctx, conn)).ok).toBe(false);
  });

  it("lets the new user sign in by email and by username", async () => {
    const input = base({ username: "signin_user" });
    const result = await signUpUser(input, ctx, conn);
    const id = result.ok ? result.userId : "";
    expect(await authenticate(String(input.email).toUpperCase(), "A-good-pass-1", conn)).toBe(id);
    expect(await authenticate("  Signin_User ", "A-good-pass-1", conn)).toBe(id);
  });
});
