import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { checkCurrentPassword } from "@/server/account/service";
import { writeAudit } from "@/server/audit/repository";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { sessions } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { clearPasswordChangeFailures, clearTwoFactorFailures, guardTwoFactor } from "./abuse";
import { checkSecondFactorIn, type TwoFactorDeps } from "./two-factor";

// Re-auth for sensitive reads (C2): the current password and a second factor again, on top of a
// two-factor sign-in. A pass stamps the calling session (`sessions.reauth_at`); the grant holds
// for 5 minutes and belongs to that session only.

export const REAUTH_WINDOW_MS = 5 * 60_000;

export type ReauthResult =
  | { ok: true }
  | { ok: false; reason: "password" | "code" | "locked" | "not_enrolled" | "no_session" };

/** Wrong password -> "password", too many attempts -> "locked"; anything else is rethrown. */
async function passwordReason(userId: string, password: string): Promise<ReauthResult | null> {
  try {
    await checkCurrentPassword(userId, password);
    return null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === "rate_limited") return { ok: false, reason: "locked" };
    if (error.code === "invalid_input") return { ok: false, reason: "password" };
    throw error;
  }
}

/**
 * Checks the password (the account-change attempt limit), then a TOTP or recovery code (the
 * two-factor limit), then stamps the session, all-or-nothing for the code and the stamp.
 */
export async function reauthenticate(
  input: { userId: string; sessionTokenHash: string; password: string; code: string },
  deps: TwoFactorDeps = {},
): Promise<ReauthResult> {
  const { userId, sessionTokenHash } = input;
  const wrongPassword = await passwordReason(userId, input.password);
  if (wrongPassword) return wrongPassword;
  const guard = await guardTwoFactor({ userId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "locked" };

  const result = await db().transaction(async (tx): Promise<ReauthResult> => {
    // The session first, so a code is never burnt for a grant that has nowhere to go.
    const session = and(eq(sessions.tokenHash, sessionTokenHash), eq(sessions.userId, userId));
    const [row] = await tx.select({ id: sessions.id }).from(sessions).where(session).for("update");
    if (!row) return { ok: false, reason: "no_session" };
    const factor = await checkSecondFactorIn(tx, userId, input.code, deps);
    if (!factor.ok) {
      return { ok: false, reason: factor.reason === "invalid" ? "code" : "not_enrolled" };
    }
    await tx.update(sessions).set({ reauthAt: clock.now() }).where(eq(sessions.id, row.id));
    await writeAudit(tx, {
      actorId: userId,
      action: "security.reauth",
      subjectType: "user",
      subjectId: userId,
    });
    return { ok: true };
  });
  if (!result.ok) return result;
  await clearTwoFactorFailures({ userId }, deps);
  await clearPasswordChangeFailures({ userId });
  return result;
}

/** Whether this session of this user passed a re-auth within the window (read from the database). */
export async function hasFreshReauth(userId: string, sessionTokenHash: string): Promise<boolean> {
  const since = new Date(clock.now().getTime() - REAUTH_WINDOW_MS);
  const row = await db().query.sessions.findFirst({
    columns: { id: true },
    where: and(
      eq(sessions.tokenHash, sessionTokenHash),
      eq(sessions.userId, userId),
      gte(sessions.reauthAt, since),
    ),
  });
  return Boolean(row);
}
