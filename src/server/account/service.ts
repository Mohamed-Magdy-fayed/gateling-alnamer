import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Locale } from "@/i18n/config";
import {
  clearPasswordChangeFailures,
  guardCodeSend,
  guardPasswordChange,
} from "@/server/auth/abuse";
import { verifyPendingEmailCode } from "@/server/auth/codes";
import { hashPassword, verifyDummy, verifyPassword } from "@/server/auth/password";
import { sendCode } from "@/server/auth/send-code";
import { invalidateUserSessions } from "@/server/auth/session";
import { cacheDelete, cacheDeleteUser } from "@/server/auth/session-cache";
import { isUniqueViolation } from "@/server/auth/sign-up";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { credentials, devices, sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";

const WRONG_PASSWORD_KEY = "auth.errors.invalid";

/** The cached copies of a user's sessions carry name and email, so a change to either drops them. */
async function purgeUserSessionCache(userId: string): Promise<void> {
  const rows = await db()
    .select({ tokenHash: sessions.tokenHash })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  await cacheDeleteUser(
    userId,
    rows.map((row) => row.tokenHash),
  );
}

export async function updateProfile(
  userId: string,
  input: { name: string; locale: Locale },
): Promise<void> {
  await db()
    .update(users)
    .set({ name: input.name, locale: input.locale })
    .where(eq(users.id, userId));
  await purgeUserSessionCache(userId);
}

/**
 * Starts adding an email to an account that has none. The address is stored only on the code row
 * (`pending_email`). A taken address gets no code and the same answer as a free one, so the form
 * cannot be used to learn which emails are registered.
 */
export async function requestAddedEmail(input: {
  userId: string;
  address: string;
  ip: string;
  locale: Locale;
}): Promise<void> {
  const { userId, address, ip, locale } = input;
  const user = await db().query.users.findFirst({
    columns: { id: true, name: true, email: true, locale: true },
    where: eq(users.id, userId),
  });
  if (!user || user.email) throw new AppError("invalid_input");

  // Keyed on the signed-in account (3 per window) and the IP, never on the address typed.
  const guard = await guardCodeSend({ identifier: `account:${userId}`, ip });
  if (!("ok" in guard)) throw new AppError("rate_limited");

  const taken = await db().query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, address),
  });
  if (taken) return;
  await sendCode({ ...user, email: null }, "email_verify", locale, address);
}

/**
 * Confirms the pending address: the code is consumed and `users.email` plus `email_verified_at` are
 * written in one transaction. If the address was taken in the meantime the code is spent and the
 * answer is the usual invalid one; the account keeps no email.
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
      return updated.length === 1;
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
 * Changes the password after checking the current one (per-user attempt limit), then signs out every
 * other session. Every wrong-password path costs one argon2 verify.
 */
export async function changePassword(input: {
  userId: string;
  current: string;
  next: string;
  currentTokenHash: string | undefined;
}): Promise<void> {
  const { userId, current, next, currentTokenHash } = input;
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

  const passwordHash = await hashPassword(next);
  await db()
    .update(credentials)
    .set({ passwordHash, passwordSalt: null, updatedAt: clock.now() })
    .where(eq(credentials.userId, userId));
  await clearPasswordChangeFailures({ userId });
  await invalidateUserSessions(userId, { exceptTokenHash: currentTokenHash });
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
