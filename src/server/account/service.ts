import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Locale } from "@/i18n/config";
import { writeAudit } from "@/server/audit/repository";
import {
  clearPasswordChangeFailures,
  guardAddEmailTarget,
  guardCodeSend,
  guardPasswordChange,
} from "@/server/auth/abuse";
import { issueCode, verifyPendingEmailCode } from "@/server/auth/codes";
import { hashPassword, verifyDummy, verifyPassword } from "@/server/auth/password";
import { sendCode } from "@/server/auth/send-code";
import { cacheDelete, cacheDeleteUser } from "@/server/auth/session-cache";
import { purgeSessionCache } from "@/server/auth/session-invalidate";
import { type RotatedSession, rotateAndRevokeIn } from "@/server/auth/session-rotate";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { credentials, devices, sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";

const WRONG_PASSWORD_KEY = "auth.errors.invalid";

type Database = ReturnType<typeof db>;
type Executor = Pick<Database, "select">;

async function sessionHashesOf(executor: Executor, userId: string): Promise<string[]> {
  const rows = await executor
    .select({ tokenHash: sessions.tokenHash })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  return rows.map((row) => row.tokenHash);
}

/** The cached copies of a user's sessions carry name and email, so a change to either drops them. */
async function purgeUserSessionCache(userId: string): Promise<void> {
  await cacheDeleteUser(userId, await sessionHashesOf(db(), userId));
}

/** The write and the list of cached sessions to drop share a transaction; the Redis purge runs after commit. */
export async function updateProfile(
  userId: string,
  input: { name: string; locale: Locale },
): Promise<void> {
  const hashes = await db().transaction(async (tx) => {
    await tx
      .update(users)
      .set({ name: input.name, locale: input.locale })
      .where(eq(users.id, userId));
    return sessionHashesOf(tx, userId);
  });
  await cacheDeleteUser(userId, hashes);
}

/**
 * Starts adding an email to an account that has none. The address is stored only on the code row
 * (`pending_email`). A taken address runs the same steps as a free one (limits, code hashing, a
 * pending code row) and gets the same answer; only the mail is not sent, and its code can never
 * confirm because the unique index refuses the address. The form therefore cannot be used to learn
 * which emails are registered. Limits: per account and IP, plus per target address (HMAC key).
 *
 * The current password is required first (A8 review M1): an added email becomes the account's
 * recovery path and ends a parent's direct reset, so a borrowed session alone cannot add one.
 */
export async function requestAddedEmail(input: {
  userId: string;
  address: string;
  currentPassword: string;
  ip: string;
  locale: Locale;
}): Promise<void> {
  const { userId, address, ip, locale } = input;
  const user = await db().query.users.findFirst({
    columns: { id: true, name: true, email: true, locale: true },
    where: eq(users.id, userId),
  });
  if (!user || user.email) throw new AppError("invalid_input");
  await checkCurrentPassword(userId, input.currentPassword);

  // Keyed on the signed-in account (3 per window) and the IP, never on the address typed.
  const guard = await guardCodeSend({ identifier: `account:${userId}`, ip });
  if (!("ok" in guard)) throw new AppError("rate_limited");

  const target = await guardAddEmailTarget({ address });
  if (!("ok" in target)) throw new AppError("rate_limited");

  const taken = await db().query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, address),
  });
  if (taken) {
    // Decoy: the same hash and insert as a real send; the code is never mailed to anyone.
    await issueCode(user.id, "email_verify", db(), address);
    return;
  }
  await sendCode({ ...user, email: null }, "email_verify", locale, { pendingEmail: address });
}

/**
 * Confirms the pending address: the code is consumed and `users.email` plus `email_verified_at` are
 * written in one transaction. If the address was taken in the meantime the unique index fails the
 * statement and the whole transaction rolls back, so the code is NOT spent (it stays usable until it
 * expires or runs out of attempts); the answer is the usual invalid one and the account keeps no email.
 * An audit row records the change (the parent email follows with the notification catalogue).
 */
export async function confirmAddedEmail(userId: string, code: string): Promise<boolean> {
  const now = clock.now();
  try {
    const confirmed = await db().transaction(async (tx) => {
      const verified = await verifyPendingEmailCode(userId, code, tx);
      if (!verified.ok) return false;
      const updated = await tx
        .update(users)
        .set({ email: verified.pendingEmail, emailVerifiedAt: now })
        .where(and(eq(users.id, userId), isNull(users.email)))
        .returning({ id: users.id });
      if (updated.length !== 1) return false;
      await writeAudit(tx, {
        actorId: userId,
        action: "account.email_added",
        subjectType: "user",
        subjectId: userId,
      });
      return true;
    });
    if (confirmed) await purgeUserSessionCache(userId);
    return confirmed;
  } catch (error) {
    // The unique index decided a race the pre-check could not see; the transaction rolled back.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Changes the password after checking the current one (per-user attempt limit). The new hash, the
 * rotation of the calling session (fresh token and id, the old one dead) and the deletion of every
 * other session are one transaction; the Redis purge runs after commit. Returns the new session
 * token for the caller to set as the cookie. Every wrong-password path costs one argon2 verify.
 */
export async function changePassword(input: {
  userId: string;
  current: string;
  next: string;
  currentTokenHash: string | undefined;
}): Promise<{ rotated: RotatedSession | null }> {
  const { userId, current, next, currentTokenHash } = input;
  await checkCurrentPassword(userId, current);

  const passwordHash = await hashPassword(next);
  const { rotated, deletedHashes } = await db().transaction(async (tx) => {
    await tx
      .update(credentials)
      .set({ passwordHash, passwordSalt: null, updatedAt: clock.now() })
      .where(eq(credentials.userId, userId));
    return rotateAndRevokeIn(tx, userId, currentTokenHash);
  });
  await purgeSessionCache(userId, deletedHashes);
  await clearPasswordChangeFailures({ userId });
  return { rotated };
}

/**
 * The signed-in user's current password, under the per-user attempt limit shared by every
 * account change that asks for it. A wrong one costs one argon2 verify, with or without a
 * credential, and throws the wrong-password error.
 */
export async function checkCurrentPassword(userId: string, current: string): Promise<void> {
  const guard = await guardPasswordChange({ userId });
  if (!("ok" in guard)) throw new AppError("rate_limited");
  const credential = await db().query.credentials.findFirst({
    columns: { passwordHash: true, passwordSalt: true },
    where: eq(credentials.userId, userId),
  });
  const matches = credential
    ? await verifyPassword(current, credential)
    : await verifyDummy(current);
  if (!matches) throw new AppError("invalid_input", { i18nKey: WRONG_PASSWORD_KEY });
}

export type SessionListItem = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  current: boolean;
  /** The device a student's session belongs to; null for everyone else. */
  deviceLabel: string | null;
};

/** The user's live sessions, newest first. Token hashes never leave this function. */
export async function listSessions(input: {
  userId: string;
  role: string;
  currentTokenHash: string | undefined;
}): Promise<SessionListItem[]> {
  const rows = await db()
    .select({
      id: sessions.id,
      tokenHash: sessions.tokenHash,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      deviceLabel: devices.label,
    })
    .from(sessions)
    .leftJoin(devices, eq(devices.id, sessions.deviceId))
    .where(and(eq(sessions.userId, input.userId), gt(sessions.expiresAt, clock.now())))
    .orderBy(desc(sessions.createdAt), desc(sessions.id));
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    current: row.tokenHash === input.currentTokenHash,
    deviceLabel: input.role === "student" ? row.deviceLabel : null,
  }));
}

/** Ends one of the user's own other sessions. The current one is refused; a stranger's id is not found. */
export async function revokeSession(input: {
  userId: string;
  id: string;
  currentTokenHash: string | undefined;
}): Promise<void> {
  const [row] = await db()
    .select({ tokenHash: sessions.tokenHash })
    .from(sessions)
    .where(and(eq(sessions.id, input.id), eq(sessions.userId, input.userId)))
    .limit(1);
  if (!row) throw new AppError("not_found");
  if (!input.currentTokenHash || row.tokenHash === input.currentTokenHash) {
    throw new AppError("forbidden", { message: "current_session" });
  }
  await db()
    .delete(sessions)
    .where(and(eq(sessions.id, input.id), eq(sessions.userId, input.userId)));
  await cacheDelete(row.tokenHash);
}
