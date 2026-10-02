import "server-only";
import crypto from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { clock } from "@/server/clock";
import { RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS } from "@/server/config/policy";
import { db } from "@/server/db";
import { verificationCodes } from "@/server/db/schema";
import { authKey, keyedHash } from "./keys";
import { randomCode } from "./password";

type Database = ReturnType<typeof db>;
/** What the verify functions run on: the shared connection or a caller's transaction. */
export type CodeExecutor = Pick<Database, "update" | "delete" | "insert" | "select">;

export type CodePurpose = "email_verify" | "password_reset";
export type VerifyResult = { ok: true; codeId: string } | { ok: false; reason: "invalid" };

const INVALID: VerifyResult = { ok: false, reason: "invalid" };

/** HMAC-SHA256 under the `codes` sub-key of AUTH_SECRET: a leaked table cannot be brute-forced offline. */
function hashCode(purpose: CodePurpose, userId: string, code: string): string {
  return keyedHash(authKey("codes"), `${purpose}:${userId}:${code}`);
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Adds a fresh code. Earlier unexpired codes stay valid (`verifyCode` accepts any live one), so a
 * stranger asking for codes cannot invalidate the one the owner is about to type; the send limit
 * (3 per account per 15 minutes) caps how many are live. The plain code is returned only so the
 * caller can queue the email; the table keeps a keyed hash.
 */
export async function issueCode(
  userId: string,
  purpose: CodePurpose,
  database: CodeExecutor = db(),
): Promise<{ codeId: string; code: string }> {
  const code = randomCode();
  const codeHash = hashCode(purpose, userId, code);
  const expiresAt = new Date(clock.now().getTime() + RESET_CODE_TTL_MS);
  const [row] = await database
    .insert(verificationCodes)
    .values({ userId, purpose, codeHash, expiresAt })
    .returning({ id: verificationCodes.id });
  if (!row) throw new Error("verification code insert returned no row");
  return { codeId: row.id, code };
}

/** Counts one attempt against every live code of the user and purpose, returning the ones still open. */
function countAttempt(database: CodeExecutor, userId: string, purpose: CodePurpose, now: Date) {
  return database
    .update(verificationCodes)
    .set({ attempts: sql`${verificationCodes.attempts} + 1` })
    .where(
      and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
        gt(verificationCodes.expiresAt, now),
        lt(verificationCodes.attempts, RESET_MAX_ATTEMPTS),
      ),
    )
    .returning({ id: verificationCodes.id, codeHash: verificationCodes.codeHash });
}

/**
 * Checks a guess against the user's live codes. The attempt is counted first, in one UPDATE that
 * only touches codes still under the limit, so parallel guesses cannot exceed it; the matching code
 * is consumed with a conditional UPDATE, so it can be used once. Pass the caller's transaction as
 * `database` to make the consume part of it (a rollback then leaves the code live). Every failure
 * is the one `invalid` result.
 */
export async function verifyCode(
  userId: string,
  purpose: CodePurpose,
  code: string,
  database: CodeExecutor = db(),
): Promise<VerifyResult> {
  const now = clock.now();
  const live = await countAttempt(database, userId, purpose, now);
  const guess = hashCode(purpose, userId, code);
  const match = live.find((row) => safeEqualHex(row.codeHash, guess));
  if (!match) return INVALID;

  const [consumed] = await database
    .update(verificationCodes)
    .set({ consumedAt: now })
    .where(and(eq(verificationCodes.id, match.id), isNull(verificationCodes.consumedAt)))
    .returning({ id: verificationCodes.id });
  if (!consumed) return INVALID;

  // The code did its job: the user's other live codes for this purpose are spent with it.
  await database
    .update(verificationCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
      ),
    );
  return { ok: true, codeId: consumed.id };
}

/**
 * The same hash and the same UPDATE as `verifyCode`, against an account that does not exist (no row
 * matches), so an unknown email costs about the same as a known one. Writes nothing.
 */
export async function verifyCodeDecoy(
  purpose: CodePurpose,
  code: string,
  database: CodeExecutor = db(),
): Promise<void> {
  const unknownUser = crypto.randomUUID();
  const live = await countAttempt(database, unknownUser, purpose, clock.now());
  const guess = hashCode(purpose, unknownUser, code);
  for (const row of live) safeEqualHex(row.codeHash, guess);
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

/** Deletes codes consumed or expired before `cutoff`; returns how many went. */
export async function purgeCodesOlderThan(
  cutoff: Date,
  database: CodeExecutor = db(),
): Promise<number> {
  const removed = await database
    .delete(verificationCodes)
    .where(
      or(
        and(isNotNull(verificationCodes.consumedAt), lt(verificationCodes.consumedAt, cutoff)),
        lt(verificationCodes.expiresAt, cutoff),
      ),
    )
    .returning({ id: verificationCodes.id });
  return removed.length;
}
