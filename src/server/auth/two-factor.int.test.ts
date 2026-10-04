import { and, eq, isNull } from "drizzle-orm";
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
const { base32Decode, totpAt } = await import("./totp");
const { randomToken, sha256 } = await import("./password");
const { createUser } = await import("@/server/orders/test-fixtures");

const NOW = new Date("2030-05-01T09:00:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
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
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  return sha256(token);
}

/** A staff user with confirmed TOTP; returns the user, the secret and the recovery codes. */
async function enrolled(d = deps()) {
  const user = await createUser(conn, { role: "teacher" });
  const setupSession = await sessionFor(user.id);
  const setup = await tf.beginTotpSetup(user.id, setupSession, d);
  if (!setup.ok) throw new Error(setup.reason);
  const secret = base32Decode(setup.secret);
  const confirmed = await tf.confirmTotpSetup(user.id, setupSession, totpAt(secret, NOW_S), d);
  if (!confirmed.ok) throw new Error(confirmed.reason);
  return { user, secret, codes: confirmed.recoveryCodes };
}

describe("two-factor enrolment", () => {
  it("setup then confirm stores a sealed secret and 10 hashed recovery codes", async () => {
    const { user, codes } = await enrolled();
    expect(codes).toHaveLength(10);
    const [row] = await conn
      .select()
      .from(schema.totpSecrets)
      .where(eq(schema.totpSecrets.userId, user.id));
    expect(row?.confirmedAt).not.toBeNull();
    expect(row?.secretEnc).toMatch(/^v1\./);
    const stored = await conn
      .select()
      .from(schema.recoveryCodes)
      .where(eq(schema.recoveryCodes.userId, user.id));
    expect(stored).toHaveLength(10);
    for (const code of codes) expect(stored.some((s) => s.codeHash.includes(code))).toBe(false);
    expect(await tf.twoFactorStatus(user.id)).toMatchObject({ enrolled: true, recoveryLeft: 10 });
    const enrolledAudit = await conn
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "two_factor.enrolled"),
          eq(schema.auditLog.subjectId, user.id),
        ),
      );
    expect(enrolledAudit).toHaveLength(1);
  });

  it("refuses a wrong confirm code and a second setup once enrolled", async () => {
    const user = await createUser(conn, { role: "teacher" });
    const d = deps();
    const own = await sessionFor(user.id);
    await tf.beginTotpSetup(user.id, own, d);
    expect(await tf.confirmTotpSetup(user.id, own, "000000", d)).toEqual({
      ok: false,
      reason: "invalid",
    });
    const { user: done } = await enrolled();
    const read = () =>
      conn.select().from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, done.id));
    const [before] = await read();
    expect(await tf.beginTotpSetup(done.id, await sessionFor(done.id), deps())).toEqual({
      ok: false,
      reason: "already_enrolled",
    });
    // The upsert itself refuses a confirmed row: the secret is never replaced (A8 re-review).
    const [after] = await read();
    expect(after?.secretEnc).toBe(before?.secretEnc);
    expect(after?.lastStep).toBe(before?.lastStep);
  });

  it("a pending secret belongs to the session that started it (A8 H1)", async () => {
    const user = await createUser(conn, { role: "teacher" });
    const d = deps();
    const attacker = await sessionFor(user.id);
    const owner = await sessionFor(user.id);
    const stolen = await tf.pendingTotpSetup(user.id, attacker, "t", d);
    if (!stolen.ok) throw new Error(stolen.reason);
    // The same session keeps its QR code across reloads.
    expect(await tf.pendingTotpSetup(user.id, attacker, "t", d)).toMatchObject({
      secret: stolen.secret,
    });
    // Another session never sees it: it gets a new secret, and the old one is gone.
    const mine = await tf.pendingTotpSetup(user.id, owner, "t", d);
    if (!mine.ok) throw new Error(mine.reason);
    expect(mine.secret).not.toBe(stolen.secret);
    const stolenCode = totpAt(base32Decode(stolen.secret), NOW_S);
    expect(await tf.confirmTotpSetup(user.id, attacker, stolenCode, d)).toEqual({
      ok: false,
      reason: "no_setup",
    });
    // Only the session that started the current setup can confirm it.
    const code = totpAt(base32Decode(mine.secret), NOW_S);
    expect(await tf.confirmTotpSetup(user.id, attacker, code, d)).toEqual({
      ok: false,
      reason: "no_setup",
    });
    expect(await tf.confirmTotpSetup(user.id, owner, code, d)).toMatchObject({ ok: true });
  });
});

describe("regenerateRecoveryCodes", () => {
  it("needs a current app code, replaces every old code and writes an audit row", async () => {
    const d = deps();
    const { user, secret, codes } = await enrolled(d);
    // The enrolment code's step is spent: a replay is refused and changes nothing.
    expect(await tf.regenerateRecoveryCodes(user.id, totpAt(secret, NOW_S), d)).toEqual({
      ok: false,
      reason: "invalid",
    });
    setClockForTests(new Date(NOW.getTime() + 60_000));
    const fresh = await tf.regenerateRecoveryCodes(user.id, totpAt(secret, NOW_S + 60), d);
    if (!fresh.ok) throw new Error(fresh.reason);
    expect(fresh.recoveryCodes).toHaveLength(10);
    expect(fresh.recoveryCodes.some((c) => codes.includes(c))).toBe(false);
    const audit = await conn
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "two_factor.recovery_regenerated"),
          eq(schema.auditLog.subjectId, user.id),
        ),
      );
    expect(audit).toHaveLength(1);
  });
});

describe("two-factor challenge", () => {
  it("a valid code elevates the session (new token, verified) and keeps other sessions", async () => {
    const d = deps();
    const { user, secret } = await enrolled(d);
    const current = await sessionFor(user.id);
    const other = await sessionFor(user.id);
    setClockForTests(new Date(NOW.getTime() + 60_000));
    const result = await tf.verifyChallenge(user.id, current, totpAt(secret, NOW_S + 60), d);
    if (!result.ok) throw new Error(result.reason);
    const rows = await conn
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));
    expect(rows.some((row) => row.tokenHash === current)).toBe(false);
    expect(rows.some((row) => row.tokenHash === other)).toBe(true);
    const elevated = rows.find((row) => row.tokenHash === sha256(result.rotated.token));
    expect(elevated?.twoFactorVerified).toBe(true);
  });

  it("refuses a replayed code and locks after 5 failures", async () => {
    const d = deps();
    const { user, secret } = await enrolled(d);
    // The enrolment code's step is used: the same code again is a replay.
    const replay = await tf.verifyChallenge(
      user.id,
      await sessionFor(user.id),
      totpAt(secret, NOW_S),
      d,
    );
    expect(replay).toEqual({ ok: false, reason: "invalid" });
    for (let i = 0; i < 4; i++) {
      await tf.verifyChallenge(user.id, await sessionFor(user.id), "000000", d);
    }
    setClockForTests(new Date(NOW.getTime() + 60_000));
    const locked = await tf.verifyChallenge(
      user.id,
      await sessionFor(user.id),
      totpAt(secret, NOW_S + 60),
      d,
    );
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
  });

  it("a recovery code works once", async () => {
    const d = deps();
    const { user, codes } = await enrolled(d);
    const code = codes[0] ?? "";
    expect((await tf.verifyChallenge(user.id, await sessionFor(user.id), code, d)).ok).toBe(true);
    expect(await tf.verifyChallenge(user.id, await sessionFor(user.id), code, d)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await tf.twoFactorStatus(user.id)).toMatchObject({ recoveryLeft: 9 });
  });
});

describe("admin two-factor reset", () => {
  it("removes the factors and the sessions, with an audit row", async () => {
    const { user } = await enrolled();
    await sessionFor(user.id);
    const admin = await createUser(conn, { role: "admin" });
    await tf.resetTwoFactor(admin.id, user.id);
    expect(await tf.twoFactorStatus(user.id)).toMatchObject({ enrolled: false, recoveryLeft: 0 });
    const left = await conn
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));
    expect(left).toHaveLength(0);
    const audit = await conn
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "two_factor.reset"), eq(schema.auditLog.subjectId, user.id)),
      );
    expect(audit).toHaveLength(1);
    const unused = await conn
      .select()
      .from(schema.recoveryCodes)
      .where(and(eq(schema.recoveryCodes.userId, user.id), isNull(schema.recoveryCodes.usedAt)));
    expect(unused).toHaveLength(0);
  });
});

describe("finish token", () => {
  it("binds the user, the session and a 10-minute expiry", () => {
    const d = deps();
    const token = tf.finishToken("user-1", "session-a", NOW_S, d);
    expect(tf.verifyFinishToken(token, "user-1", "session-a", NOW_S + 60, d)).toBe(true);
    expect(tf.verifyFinishToken(token, "user-1", "session-a", NOW_S + 601, d)).toBe(false);
    expect(tf.verifyFinishToken(token, "user-1", "session-b", NOW_S, d)).toBe(false);
    expect(tf.verifyFinishToken(token, "user-2", "session-a", NOW_S, d)).toBe(false);
    const [expires] = token.split(".");
    expect(
      tf.verifyFinishToken(
        `${Number(expires) + 600}.${token.split(".")[1]}`,
        "user-1",
        "session-a",
        NOW_S,
        d,
      ),
    ).toBe(false);
    expect(tf.verifyFinishToken("garbage", "user-1", "session-a", NOW_S, d)).toBe(false);
  });
});
