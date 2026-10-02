import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setClockForTests } from "@/server/clock";
import { RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS } from "@/server/config/policy";
import * as schema from "@/server/db/schema";
import { passwordResetCodes, users, verificationCodes } from "@/server/db/schema";
import { issueCode, issueCodeDecoy, verifyCode } from "./codes";
import { sha256 } from "./password";

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
  it("returns a 6-digit code and stores only a hash of purpose:userId:code", async () => {
    const userId = await makeUser();
    const { code, codeId } = await issueCode(userId, "password_reset", conn);
    expect(code).toMatch(/^\d{6}$/);
    const row = await rowOf(codeId);
    expect(row?.codeHash).not.toBe(code);
    expect(row?.codeHash).toBe(sha256(`password_reset:${userId}:${code}`));
    expect(row?.attempts).toBe(0);
    expect(row?.emailStatus).toBe("queued");
    expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + RESET_CODE_TTL_MS);
  });

  it("deletes the user's earlier unconsumed codes for that purpose only", async () => {
    const userId = await makeUser();
    const first = await issueCode(userId, "password_reset", conn);
    const other = await issueCode(userId, "email_verify", conn);
    const second = await issueCode(userId, "password_reset", conn);
    const rows = await conn
      .select()
      .from(verificationCodes)
      .where(eq(verificationCodes.userId, userId));
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(first.codeId);
    expect(ids).toContain(other.codeId);
    expect(ids).toContain(second.codeId);
  });

  it("decoy issue writes no rows", async () => {
    const before = await conn.select().from(verificationCodes);
    await issueCodeDecoy("password_reset", conn);
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

describe("verification_codes_copy migration", () => {
  const dir = path.join(process.cwd(), "src/server/db/migrations");
  const file = readdirSync(dir).find((n) => n.endsWith("_verification_codes_copy.sql"));

  it("exists", () => {
    expect(file).toBeDefined();
  });

  it("copies only live reset codes and backfills email_verified_at", async () => {
    const statements = readFileSync(path.join(dir, file ?? "missing.sql"), "utf8").split(
      "--> statement-breakpoint",
    );
    const created = new Date("2026-01-01T00:00:00Z");
    const rollback = new Error("rollback");
    let hashes: string[] = [];
    let live: typeof verificationCodes.$inferSelect | undefined;
    let withEmailAt: Date | null | undefined;
    let noEmailAt: Date | null | undefined;

    await conn
      .transaction(async (tx) => {
        const mk = async (email: string | null, username: string | null) => {
          const [u] = await tx
            .insert(users)
            .values({ name: "M", email, username, createdAt: created })
            .returning({ id: users.id });
          if (!u) throw new Error("no user");
          return u.id;
        };
        const withEmail = await mk("mig-a@example.test", null);
        const noEmail = await mk(null, "mig_user");
        const u2 = await mk("mig-b@example.test", null);
        const u3 = await mk("mig-c@example.test", null);
        const future = new Date(Date.now() + 600_000);
        await tx.insert(passwordResetCodes).values([
          { userId: withEmail, codeHash: "live-hash", attempts: 2, expiresAt: future },
          { userId: u2, codeHash: "expired-hash", expiresAt: new Date(Date.now() - 1000) },
          { userId: u3, codeHash: "consumed-hash", expiresAt: future, consumedAt: new Date() },
        ]);
        for (const statement of statements) await tx.execute(sql.raw(statement));
        const copied = await tx.select().from(verificationCodes);
        const verified = await tx.select({ id: users.id, at: users.emailVerifiedAt }).from(users);
        hashes = copied.map((c) => c.codeHash).filter((h) => h.endsWith("-hash"));
        live = copied.find((c) => c.codeHash === "live-hash");
        withEmailAt = verified.find((v) => v.id === withEmail)?.at;
        noEmailAt = verified.find((v) => v.id === noEmail)?.at;
        throw rollback;
      })
      .catch((e: unknown) => {
        if (e !== rollback) throw e;
      });

    expect(hashes).toEqual(["live-hash"]);
    expect(live?.purpose).toBe("password_reset");
    expect(live?.emailStatus).toBe("sent");
    expect(live?.attempts).toBe(2);
    expect(withEmailAt).toEqual(created);
    expect(noEmailAt).toBeNull();
  });
});
