import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setClockForTests } from "@/server/clock";
import { RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS } from "@/server/config/policy";
import * as schema from "@/server/db/schema";
import { users, verificationCodes } from "@/server/db/schema";
import { issueCode, purgeCodesOlderThan, verifyCode, verifyCodeDecoy } from "./codes";
import { authKey, keyedHash } from "./keys";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} });
const conn = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

const NOW = new Date("2026-10-02T10:00:00Z");
const INVALID = { ok: false, reason: "invalid" } as const;
let seq = 0;

async function makeUser(): Promise<string> {
  seq += 1;
  const [u] = await conn
    .insert(users)
    .values({ name: "Codes", email: `codes${seq}@example.test` })
    .returning({ id: users.id });
  if (!u) throw new Error("no user");
  return u.id;
}

async function rowOf(id: string) {
  const [row] = await conn.select().from(verificationCodes).where(eq(verificationCodes.id, id));
  return row;
}

beforeEach(() => setClockForTests(NOW));
afterEach(() => setClockForTests(null));

describe("issueCode", () => {
  it("returns a 6-digit code and stores only an HMAC of purpose:userId:code under the codes key", async () => {
    const userId = await makeUser();
    const { code, codeId } = await issueCode(userId, "password_reset", conn);
    expect(code).toMatch(/^\d{6}$/);
    const row = await rowOf(codeId);
    expect(row?.codeHash).not.toBe(code);
    expect(row?.codeHash).toBe(keyedHash(authKey("codes"), `password_reset:${userId}:${code}`));
    expect(row?.attempts).toBe(0);
    expect(row?.emailStatus).toBe("queued");
    expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + RESET_CODE_TTL_MS);
  });

  it("keeps the user's earlier unconsumed codes, for any purpose", async () => {
    const userId = await makeUser();
    const first = await issueCode(userId, "password_reset", conn);
    const other = await issueCode(userId, "email_verify", conn);
    const second = await issueCode(userId, "password_reset", conn);
    const rows = await conn
      .select()
      .from(verificationCodes)
      .where(eq(verificationCodes.userId, userId));
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([first.codeId, other.codeId, second.codeId]));
  });
});

describe("verifyCodeDecoy", () => {
  it("writes nothing and burns the same hash and query work", async () => {
    const before = await conn.select().from(verificationCodes);
    await verifyCodeDecoy("password_reset", "123456", conn);
    const after = await conn.select().from(verificationCodes);
    expect(after.length).toBe(before.length);
  });
});

describe("verifyCode", () => {
  it("accepts the right code once and marks it consumed", async () => {
    const userId = await makeUser();
    const { code, codeId } = await issueCode(userId, "password_reset", conn);
    expect(await verifyCode(userId, "password_reset", code, conn)).toEqual({ ok: true, codeId });
    expect((await rowOf(codeId))?.consumedAt).not.toBeNull();
    expect(await verifyCode(userId, "password_reset", code, conn)).toEqual(INVALID);
  });

  it("increments attempts on a wrong code and returns invalid", async () => {
    const userId = await makeUser();
    const { code, codeId } = await issueCode(userId, "password_reset", conn);
    const wrong = code === "000000" ? "000001" : "000000";
    expect(await verifyCode(userId, "password_reset", wrong, conn)).toEqual(INVALID);
    expect((await rowOf(codeId))?.attempts).toBe(1);
  });

  it("rejects the right code after five wrong attempts", async () => {
    const userId = await makeUser();
    const { code } = await issueCode(userId, "password_reset", conn);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < RESET_MAX_ATTEMPTS; i++) {
      await verifyCode(userId, "password_reset", wrong, conn);
    }
    expect(await verifyCode(userId, "password_reset", code, conn)).toEqual(INVALID);
  });

  it("rejects an expired code", async () => {
    const userId = await makeUser();
    const { code } = await issueCode(userId, "password_reset", conn);
    setClockForTests(new Date(NOW.getTime() + RESET_CODE_TTL_MS + 1));
    expect(await verifyCode(userId, "password_reset", code, conn)).toEqual(INVALID);
  });

  it("does not accept a code for another purpose or another user", async () => {
    const userId = await makeUser();
    const otherId = await makeUser();
    const { code } = await issueCode(userId, "password_reset", conn);
    expect(await verifyCode(userId, "email_verify", code, conn)).toEqual(INVALID);
    expect(await verifyCode(otherId, "password_reset", code, conn)).toEqual(INVALID);
  });
});

describe("verifyCode with several live codes", () => {
  it("accepts any live code for the user and purpose, and spends the rest with it", async () => {
    const userId = await makeUser();
    const older = await issueCode(userId, "password_reset", conn);
    const newer = await issueCode(userId, "password_reset", conn);
    expect(await verifyCode(userId, "password_reset", older.code, conn)).toEqual({
      ok: true,
      codeId: older.codeId,
    });
    expect(await verifyCode(userId, "password_reset", newer.code, conn)).toEqual(INVALID);
  });

  it("accepts the newer code while the older one is still live", async () => {
    const userId = await makeUser();
    await issueCode(userId, "password_reset", conn);
    const newer = await issueCode(userId, "password_reset", conn);
    expect(await verifyCode(userId, "password_reset", newer.code, conn)).toEqual({
      ok: true,
      codeId: newer.codeId,
    });
  });

  it("counts a wrong guess against every live code", async () => {
    const userId = await makeUser();
    const a = await issueCode(userId, "password_reset", conn);
    const b = await issueCode(userId, "password_reset", conn);
    const wrong = [a.code, b.code].includes("000000") ? "000001" : "000000";
    await verifyCode(userId, "password_reset", wrong, conn);
    expect((await rowOf(a.codeId))?.attempts).toBe(1);
    expect((await rowOf(b.codeId))?.attempts).toBe(1);
  });
});

describe("verifyCode consumption and concurrency", () => {
  it("a consumed code is invalid, even with attempts and lifetime left", async () => {
    const userId = await makeUser();
    const { code, codeId } = await issueCode(userId, "email_verify", conn);
    expect((await verifyCode(userId, "email_verify", code, conn)).ok).toBe(true);
    const row = await rowOf(codeId);
    expect(row?.consumedAt).not.toBeNull();
    expect(row?.attempts).toBeLessThan(RESET_MAX_ATTEMPTS);
    expect(await verifyCode(userId, "email_verify", code, conn)).toEqual(INVALID);
  });

  it("parallel right and wrong guesses never exceed the attempt limit and consume at most once", async () => {
    const userId = await makeUser();
    const { code, codeId } = await issueCode(userId, "password_reset", conn);
    const wrong = code === "000000" ? "000001" : "000000";
    const guesses = [
      wrong,
      wrong,
      wrong,
      wrong,
      wrong,
      wrong,
      code,
      wrong,
      wrong,
      code,
      wrong,
      code,
    ];
    const results = await Promise.all(
      guesses.map((guess) => verifyCode(userId, "password_reset", guess, conn)),
    );
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
    expect((await rowOf(codeId))?.attempts).toBeLessThanOrEqual(RESET_MAX_ATTEMPTS);
  });

  it("parallel right guesses succeed exactly once", async () => {
    const userId = await makeUser();
    const { code } = await issueCode(userId, "password_reset", conn);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyCode(userId, "password_reset", code, conn)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("joins the caller's transaction: a rollback leaves the code unconsumed", async () => {
    const userId = await makeUser();
    const { code, codeId } = await issueCode(userId, "password_reset", conn);
    const rollback = new Error("rollback");
    await conn
      .transaction(async (tx) => {
        expect((await verifyCode(userId, "password_reset", code, tx)).ok).toBe(true);
        throw rollback;
      })
      .catch((e: unknown) => {
        if (e !== rollback) throw e;
      });
    expect((await rowOf(codeId))?.consumedAt).toBeNull();
    expect((await verifyCode(userId, "password_reset", code, conn)).ok).toBe(true);
  });
});

describe("purgeCodesOlderThan", () => {
  it("deletes codes consumed or expired before the cutoff and keeps the rest", async () => {
    const userId = await makeUser();
    const cutoff = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const HOUR = 60 * 60 * 1000;
    const row = (name: string, expiresAt: Date, consumedAt: Date | null = null) => ({
      userId,
      purpose: "password_reset" as const,
      codeHash: name,
      expiresAt,
      consumedAt,
    });
    await conn
      .insert(verificationCodes)
      .values([
        row("purge-old-consumed", ago(25 * HOUR), ago(25 * HOUR)),
        row("purge-old-expired", ago(26 * HOUR)),
        row("purge-recent-consumed", ago(HOUR), ago(HOUR)),
        row("purge-recent-expired", ago(HOUR)),
        row("purge-live", new Date(NOW.getTime() + HOUR)),
      ]);
    const deleted = await purgeCodesOlderThan(cutoff, conn);
    expect(deleted).toBeGreaterThanOrEqual(2);
    const left = (
      await conn.select().from(verificationCodes).where(eq(verificationCodes.userId, userId))
    ).map((r) => r.codeHash);
    expect(left.sort()).toEqual(["purge-live", "purge-recent-consumed", "purge-recent-expired"]);
  });
});
