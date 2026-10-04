import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import * as schema from "@/server/db/schema";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example", APP_MODE: "demo" }),
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const dbSchema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  const conn = drizzle(client, { schema: dbSchema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => import("@/server/orders/test-fixtures").TestConn;
  closeTestDb: () => Promise<void>;
};
const conn = dbModule.db();
const { completeGoogleSignUp, resolveOAuthSignIn } = await import("./decide");
const { createUser } = await import("@/server/orders/test-fixtures");
const { createPendingSignup } = await import("./pending-store");

/** A live one-time pending sign-up, as the callback creates it. */
const pendingCtx = async () => ({
  locale: "ar" as const,
  now: NOW,
  pendingId: await createPendingSignup(new Date(NOW.getTime() + 15 * 60_000), NOW),
});

const NOW = new Date("2030-05-01T09:00:00.000Z");
const identity = (
  overrides: Partial<{ email: string; emailVerified: boolean; subject: string }> = {},
) => ({
  subject: overrides.subject ?? `sub-${crypto.randomUUID()}`,
  email: overrides.email ?? `g-${crypto.randomUUID()}@example.test`,
  emailVerified: overrides.emailVerified ?? true,
  name: "Google Person",
});

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("resolveOAuthSignIn", () => {
  it("a linked Google account signs its user in", async () => {
    const user = await createUser(conn);
    const id = identity();
    await conn.insert(schema.oauthAccounts).values({
      id: crypto.randomUUID(),
      userId: user.id,
      provider: "google",
      subject: id.subject,
      email: id.email,
    });
    expect(await resolveOAuthSignIn(id)).toEqual({ kind: "signin", userId: user.id });
  });

  it("links a verified Google email to the matching verified account, with an audit row", async () => {
    const user = await createUser(conn);
    const id = identity({ email: user.email ?? "" });
    expect(await resolveOAuthSignIn(id)).toEqual({ kind: "signin", userId: user.id });
    const [link] = await conn
      .select()
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.subject, id.subject));
    expect(link?.userId).toBe(user.id);
    const audit = await conn
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "oauth.linked"), eq(schema.auditLog.subjectId, user.id)),
      );
    expect(audit).toHaveLength(1);
  });

  it("does not link to an account whose own email is unverified", async () => {
    const user = await createUser(conn, { verified: false });
    expect(await resolveOAuthSignIn(identity({ email: user.email ?? "" }))).toEqual({
      kind: "needs_password",
    });
  });

  it("a new verified email needs sign-up; an unverified Google email is refused", async () => {
    expect(await resolveOAuthSignIn(identity())).toEqual({ kind: "new" });
    expect(await resolveOAuthSignIn(identity({ emailVerified: false }))).toEqual({
      kind: "refused",
    });
  });

  it("never auto-links a staff account by email", async () => {
    const teacher = await createUser(conn, { role: "teacher" });
    expect(await resolveOAuthSignIn(identity({ email: teacher.email ?? "" }))).toEqual({
      kind: "needs_password",
    });
  });

  it("a suspended user is refused", async () => {
    const user = await createUser(conn);
    await conn
      .update(schema.users)
      .set({ status: "suspended" })
      .where(eq(schema.users.id, user.id));
    expect(await resolveOAuthSignIn(identity({ email: user.email ?? "" }))).toEqual({
      kind: "refused",
    });
  });
});

describe("completeGoogleSignUp", () => {
  const form = (overrides: Record<string, unknown> = {}) => ({
    name: "Google Student",
    role: "student" as const,
    dateOfBirth: "2018-03-04",
    guardianConsent: true,
    ...overrides,
  });

  it("creates a verified account without a password, linked to Google", async () => {
    const id = identity();
    const result = await completeGoogleSignUp(id, form(), await pendingCtx());
    if (!result.ok) throw new Error(JSON.stringify(result));
    const [user] = await conn.select().from(schema.users).where(eq(schema.users.id, result.userId));
    expect(user).toMatchObject({ email: id.email, role: "student" });
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(user?.publicNumber).toBeTruthy();
    const creds = await conn
      .select()
      .from(schema.credentials)
      .where(eq(schema.credentials.userId, result.userId));
    expect(creds).toHaveLength(0);
    expect(await resolveOAuthSignIn(id)).toEqual({ kind: "signin", userId: result.userId });
  });

  it("applies the age and consent rules", async () => {
    const ctx = await pendingCtx();
    expect(
      (await completeGoogleSignUp(identity(), form({ dateOfBirth: "2025-01-01" }), ctx)).ok,
    ).toBe(false);
    expect(
      (
        await completeGoogleSignUp(
          identity(),
          form({ role: "parent", dateOfBirth: "2015-01-01", guardianConsent: false }),
          ctx,
        )
      ).ok,
    ).toBe(false);
    expect((await completeGoogleSignUp(identity(), form({ guardianConsent: false }), ctx)).ok).toBe(
      false,
    );
    expect((await completeGoogleSignUp(identity(), form({ name: "x" }), ctx)).ok).toBe(false);
  });

  it("works once: a replay of the same pending sign-up is refused, never signed in (A8 L3)", async () => {
    const id = identity();
    const ctx = await pendingCtx();
    const first = await completeGoogleSignUp(id, form(), ctx);
    expect(first.ok).toBe(true);
    // The account exists now, so a replay would hit the unique email: still refused.
    expect(await completeGoogleSignUp(id, form(), ctx)).toEqual({
      ok: false,
      decision: { kind: "refused" },
    });
    // A fresh pending sign-up for the same identity follows the linking rules.
    expect(await completeGoogleSignUp(id, form(), await pendingCtx())).toEqual({
      ok: false,
      decision: { kind: "signin", userId: first.ok ? first.userId : "" },
    });
  });

  it("refuses an expired pending sign-up", async () => {
    const ctx = await pendingCtx();
    const late = { ...ctx, now: new Date(NOW.getTime() + 16 * 60_000) };
    expect(await completeGoogleSignUp(identity(), form(), late)).toEqual({
      ok: false,
      decision: { kind: "refused" },
    });
  });
});
