import "server-only";
import crypto from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { clock } from "@/server/clock";
import { RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS } from "@/server/config/policy";
import { db } from "@/server/db";
import { verificationCodes } from "@/server/db/schema";
import { randomCode, sha256 } from "./password";

type Database = ReturnType<typeof db>;

export type CodePurpose = "email_verify" | "password_reset";
export type VerifyResult = { ok: true; codeId: string } | { ok: false; reason: "invalid" };

const INVALID: VerifyResult = { ok: false, reason: "invalid" };

function hashCode(purpose: CodePurpose, userId: string, code: string): string {
  return sha256(`${purpose}:${userId}:${code}`);
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Replaces the user's unconsumed codes for `purpose` with a fresh one. The plain code is returned
 * only so the caller can queue the email; the table keeps a hash.
 */
export async function issueCode(
  userId: string,
  purpose: CodePurpose,
  database: Database = db(),
): Promise<{ codeId: string; code: string }> {
  const code = randomCode();
  const codeHash = hashCode(purpose, userId, code);
  const expiresAt = new Date(clock.now().getTime() + RESET_CODE_TTL_MS);
  const codeId = await database.transaction(async (tx) => {
    await tx
      .delete(verificationCodes)
      .where(
        and(
          eq(verificationCodes.userId, userId),
          eq(verificationCodes.purpose, purpose),
          isNull(verificationCodes.consumedAt),
        ),
      );
    const [row] = await tx
      .insert(verificationCodes)
      .values({ userId, purpose, codeHash, expiresAt })
      .returning({ id: verificationCodes.id });
    if (!row) throw new Error("verification code insert returned no row");
    return row.id;
  });
  return { codeId, code };
}

/**
 * Same hashing and DB round trips as `issueCode` for an account that does not exist, so an unknown
 * email costs about the same as a known one. Writes nothing.
 */
export async function issueCodeDecoy(
  purpose: CodePurpose,
  database: Database = db(),
): Promise<void> {
  const userId = crypto.randomUUID();
  const code = randomCode();
  hashCode(purpose, userId, code);
  await database.transaction(async (tx) => {
    await tx
      .delete(verificationCodes)
      .where(
        and(
          eq(verificationCodes.userId, userId),
          eq(verificationCodes.purpose, purpose),
          isNull(verificationCodes.consumedAt),
        ),
      );
    await tx
      .select({ id: verificationCodes.id })
      .from(verificationCodes)
      .where(eq(verificationCodes.userId, userId))
      .limit(1);
  });
}

/**
 * Checks the newest unconsumed code. The attempt is counted first, in the same transaction, so
 * parallel guesses cannot exceed the limit. Every failure is the one `invalid` result.
 */
export async function verifyCode(
  userId: string,
  purpose: CodePurpose,
  code: string,
  database: Database = db(),
): Promise<VerifyResult> {
  return database.transaction(async (tx) => {
    const [latest] = await tx
      .select({ id: verificationCodes.id })
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.userId, userId),
          eq(verificationCodes.purpose, purpose),
          isNull(verificationCodes.consumedAt),
        ),
      )
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    if (!latest) return INVALID;

    const [row] = await tx
      .update(verificationCodes)
      .set({ attempts: sql`${verificationCodes.attempts} + 1` })
      .where(and(eq(verificationCodes.id, latest.id), isNull(verificationCodes.consumedAt)))
      .returning();
    if (!row) return INVALID;

    const now = clock.now();
    const matches = safeEqualHex(row.codeHash, hashCode(purpose, userId, code));
    if (row.attempts > RESET_MAX_ATTEMPTS || row.expiresAt <= now || !matches) return INVALID;

    const [consumed] = await tx
      .update(verificationCodes)
      .set({ consumedAt: now })
      .where(and(eq(verificationCodes.id, row.id), isNull(verificationCodes.consumedAt)))
      .returning({ id: verificationCodes.id });
    return consumed ? { ok: true, codeId: consumed.id } : INVALID;
  });
}

/** Burns the same hash work as `verifyCode` for an unknown account. */
export async function verifyCodeDecoy(
  purpose: CodePurpose,
  code: string,
  database: Database = db(),
): Promise<void> {
  safeEqualHex(
    hashCode(purpose, crypto.randomUUID(), code),
    hashCode(purpose, crypto.randomUUID(), code),
  );
  await database
    .select({ id: verificationCodes.id })
    .from(verificationCodes)
    .where(eq(verificationCodes.id, crypto.randomUUID()))
    .limit(1);
}

export async function markCodeEmailSent(codeId: string): Promise<void> {
  await db()
    .update(verificationCodes)
    .set({ emailStatus: "sent", emailSentAt: clock.now() })
    .where(eq(verificationCodes.id, codeId));
}

export async function markCodeEmailFailed(codeId: string): Promise<void> {
  await db()
    .update(verificationCodes)
    .set({ emailStatus: "failed" })
    .where(eq(verificationCodes.id, codeId));
}

export async function deleteCode(codeId: string): Promise<void> {
  await db().delete(verificationCodes).where(eq(verificationCodes.id, codeId));
}
