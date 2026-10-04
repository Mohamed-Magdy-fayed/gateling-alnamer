import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import * as schema from "@/server/db/schema";
import { MemoryLimiter } from "../../../test/fake-limiter";

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
const tf = await import("./two-factor");
const { hasFreshReauth, reauthenticate, REAUTH_WINDOW_MS } = await import("./reauth");
const { base32Decode, totpAt } = await import("./totp");
const { hashPassword, randomToken, sha256 } = await import("./password");
const { createUser } = await import("@/server/orders/test-fixtures");

const NOW = new Date("2030-06-01T09:00:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const PASSWORD = "Correct-horse-9";
const KEYS = { totp: Buffer.alloc(32, 1), recovery: Buffer.alloc(32, 2) };
const deps = () => ({ ...KEYS, limiter: new MemoryLimiter(), key: Buffer.alloc(32, 3) });

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

async function sessionFor(userId: string) {
  const token = randomToken();
  await conn.insert(schema.sessions).values({
    tokenHash: sha256(token),
    userId,
    twoFactorVerified: true,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  return sha256(token);
}

/** An admin with a password and confirmed TOTP, and a verified session. */
async function staff(d = deps()) {
  const user = await createUser(conn, { role: "admin" });
  await conn
    .insert(schema.credentials)
    .values({ userId: user.id, passwordHash: await hashPassword(PASSWORD) });
  const tokenHash = await sessionFor(user.id);
  const setup = await tf.beginTotpSetup(user.id, tokenHash, d);
  if (!setup.ok) throw new Error(setup.reason);
  const secret = base32Decode(setup.secret);
  // Confirm on the previous step so the current one is still unused.
  setClockForTests(new Date(NOW.getTime() - 30_000));
  const confirmed = await tf.confirmTotpSetup(user.id, tokenHash, totpAt(secret, NOW_S - 30), d);
  setClockForTests(NOW);
  if (!confirmed.ok) throw new Error(confirmed.reason);
  return { user, tokenHash, secret, codes: confirmed.recoveryCodes, d };
}

describe("reauthenticate", () => {
  it("password plus a TOTP code opens a 5-minute grant on that session only", async () => {
    const s = await staff();
    const other = await sessionFor(s.user.id);
    expect(await hasFreshReauth(s.user.id, s.tokenHash)).toBe(false);
    const result = await reauthenticate(
      {
        userId: s.user.id,
        sessionTokenHash: s.tokenHash,
        password: PASSWORD,
        code: totpAt(s.secret, NOW_S),
      },
      s.d,
    );
    expect(result).toEqual({ ok: true });
    expect(await hasFreshReauth(s.user.id, s.tokenHash)).toBe(true);
    expect(await hasFreshReauth(s.user.id, other)).toBe(false);

    setClockForTests(new Date(NOW.getTime() + REAUTH_WINDOW_MS));
    expect(await hasFreshReauth(s.user.id, s.tokenHash)).toBe(true);
    setClockForTests(new Date(NOW.getTime() + REAUTH_WINDOW_MS + 1));
    expect(await hasFreshReauth(s.user.id, s.tokenHash)).toBe(false);

    const audit = await conn
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.actorId, s.user.id), eq(schema.auditLog.action, "security.reauth")),
      );
    expect(audit).toHaveLength(1);
  });

  it("accepts a recovery code and burns it", async () => {
    const s = await staff();
    const code = s.codes[0] ?? "";
    const input = { userId: s.user.id, sessionTokenHash: s.tokenHash, password: PASSWORD, code };
    expect(await reauthenticate(input, s.d)).toEqual({ ok: true });
    expect(await reauthenticate(input, s.d)).toEqual({ ok: false, reason: "code" });
  });

  it("refuses a wrong password before looking at the code", async () => {
    const s = await staff();
    const result = await reauthenticate(
      {
        userId: s.user.id,
        sessionTokenHash: s.tokenHash,
        password: "Wrong-password-1",
        code: totpAt(s.secret, NOW_S),
      },
      s.d,
    );
    expect(result).toEqual({ ok: false, reason: "password" });
    expect(await hasFreshReauth(s.user.id, s.tokenHash)).toBe(false);
  });

  it("refuses a wrong code, a replayed code and another user's session", async () => {
    const s = await staff();
    const base = { userId: s.user.id, sessionTokenHash: s.tokenHash, password: PASSWORD };
    expect(await reauthenticate({ ...base, code: "000000" }, s.d)).toEqual({
      ok: false,
      reason: "code",
    });
    const code = totpAt(s.secret, NOW_S);
    expect(await reauthenticate({ ...base, code }, s.d)).toEqual({ ok: true });
    expect(await reauthenticate({ ...base, code }, s.d)).toEqual({ ok: false, reason: "code" });

    const t = await staff();
    const foreign = await reauthenticate(
      { ...base, sessionTokenHash: t.tokenHash, code: totpAt(s.secret, NOW_S + 30) },
      s.d,
    );
    expect(foreign).toEqual({ ok: false, reason: "no_session" });
    expect(await hasFreshReauth(t.user.id, t.tokenHash)).toBe(false);
  });

  it("locks after five wrong codes", async () => {
    const s = await staff();
    const base = { userId: s.user.id, sessionTokenHash: s.tokenHash, password: PASSWORD };
    for (let i = 0; i < 5; i += 1) await reauthenticate({ ...base, code: "000000" }, s.d);
    const locked = await reauthenticate({ ...base, code: totpAt(s.secret, NOW_S) }, s.d);
    expect(locked).toEqual({ ok: false, reason: "locked" });
  });

  it("needs an enrolled second factor", async () => {
    const user = await createUser(conn, { role: "admin" });
    await conn
      .insert(schema.credentials)
      .values({ userId: user.id, passwordHash: await hashPassword(PASSWORD) });
    const tokenHash = await sessionFor(user.id);
    const result = await reauthenticate(
      { userId: user.id, sessionTokenHash: tokenHash, password: PASSWORD, code: "123456" },
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "not_enrolled" });
  });
});
