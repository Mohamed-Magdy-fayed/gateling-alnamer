import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, count, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { writeAudit } from "@/server/audit/repository";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { passkeys, recoveryCodes, totpSecrets } from "@/server/db/schema";
import { type AbuseDeps, clearTwoFactorFailures, guardTwoFactor } from "./abuse";
import { authKey, keyedHash } from "./keys";
import { newRecoveryCodes, normalizeRecoveryCode } from "./recovery-codes";
import { open, seal } from "./secret-box";
import { cacheDelete } from "./session-cache";
import { invalidateUserSessionsCore } from "./session-invalidate";
import { elevateSessionIn, type RotatedSession } from "./session-rotate";
import { base32Decode, newTotpSecret, otpauthUri, verifyTotp } from "./totp";

// Two-factor sign-in for staff (A4): TOTP with sealed secrets, single-use recovery codes, and the
// session step-up after a passed challenge.

export type TwoFactorDeps = AbuseDeps & { totp?: Buffer; recovery?: Buffer };

const totpKey = (deps: TwoFactorDeps) => deps.totp ?? authKey("totp");
const recoveryKey = (deps: TwoFactorDeps) => deps.recovery ?? authKey("recovery");
const nowS = () => Math.floor(clock.now().getTime() / 1000);

export type TwoFactorStatus = { enrolled: boolean; confirmedAt: Date | null; recoveryLeft: number };

export async function twoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const [secret] = await db()
    .select({ confirmedAt: totpSecrets.confirmedAt })
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, userId))
    .limit(1);
  const [left] = await db()
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return {
    enrolled: Boolean(secret?.confirmedAt),
    confirmedAt: secret?.confirmedAt ?? null,
    recoveryLeft: left?.n ?? 0,
  };
}

export type SetupResult =
  | { ok: true; secret: string; uri: string }
  | { ok: false; reason: "already_enrolled" };

/** Starts (or restarts) enrolment: a fresh unconfirmed secret. Refused once enrolled. */
export async function beginTotpSetup(
  userId: string,
  deps: TwoFactorDeps = {},
  account = "",
): Promise<SetupResult> {
  const [existing] = await db()
    .select({ confirmedAt: totpSecrets.confirmedAt })
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, userId))
    .limit(1);
  if (existing?.confirmedAt) return { ok: false, reason: "already_enrolled" };
  const secret = newTotpSecret();
  const sealed = seal(totpKey(deps), secret);
  await db()
    .insert(totpSecrets)
    .values({ userId, secretEnc: sealed })
    .onConflictDoUpdate({ target: totpSecrets.userId, set: { secretEnc: sealed, lastStep: null } });
  return { ok: true, secret, uri: otpauthUri(secret, account || "account") };
}

async function storeRecoveryCodes(
  executor: Pick<ReturnType<typeof db>, "insert" | "delete">,
  userId: string,
  deps: TwoFactorDeps,
): Promise<string[]> {
  const codes = newRecoveryCodes();
  await executor.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await executor.insert(recoveryCodes).values(
    codes.map((code) => ({
      id: uuidv7(),
      userId,
      codeHash: keyedHash(recoveryKey(deps), normalizeRecoveryCode(code) ?? code),
    })),
  );
  return codes;
}

export type ConfirmResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: "invalid" | "no_setup" | "locked"; until?: Date };

/** Confirms enrolment with a first code; creates the recovery codes (shown once). */
export async function confirmTotpSetup(
  userId: string,
  code: string,
  deps: TwoFactorDeps = {},
): Promise<ConfirmResult> {
  const guard = await guardTwoFactor({ userId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "locked", until: guard.until };
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, userId))
      .for("update");
    if (!row || row.confirmedAt) return { ok: false, reason: "no_setup" };
    const secret = open(totpKey(deps), row.secretEnc);
    if (!secret) return { ok: false, reason: "no_setup" };
    const step = verifyTotp(base32Decode(secret), code, nowS(), row.lastStep);
    if (step === null) return { ok: false, reason: "invalid" };
    await tx
      .update(totpSecrets)
      .set({ confirmedAt: clock.now(), lastStep: step })
      .where(eq(totpSecrets.userId, userId));
    const codes = await storeRecoveryCodes(tx, userId, deps);
    await clearTwoFactorFailures({ userId }, deps);
    return { ok: true, recoveryCodes: codes };
  });
}

export type ChallengeResult =
  | { ok: true; rotated: RotatedSession; usedRecoveryCode: boolean }
  | { ok: false; reason: "invalid" | "locked" | "not_enrolled" | "no_session"; until?: Date };

/**
 * The sign-in challenge: a 6-digit TOTP code, or a recovery code (single use). On success the
 * calling session is stepped up (new token, verified); the caller sets the cookie.
 */
export async function verifyChallenge(
  userId: string,
  currentTokenHash: string,
  input: string,
  deps: TwoFactorDeps = {},
): Promise<ChallengeResult> {
  const guard = await guardTwoFactor({ userId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "locked", until: guard.until };
  const result = await db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, userId))
      .for("update");
    if (!row?.confirmedAt) return { ok: false as const, reason: "not_enrolled" as const };

    let usedRecoveryCode = false;
    const digits = input.replace(/\s/g, "");
    if (/^\d{6}$/.test(digits)) {
      const secret = open(totpKey(deps), row.secretEnc);
      const step = secret ? verifyTotp(base32Decode(secret), digits, nowS(), row.lastStep) : null;
      if (step === null) return { ok: false as const, reason: "invalid" as const };
      await tx.update(totpSecrets).set({ lastStep: step }).where(eq(totpSecrets.userId, userId));
    } else {
      const normal = normalizeRecoveryCode(input);
      if (!normal) return { ok: false as const, reason: "invalid" as const };
      const used = await tx
        .update(recoveryCodes)
        .set({ usedAt: clock.now() })
        .where(
          and(
            eq(recoveryCodes.userId, userId),
            eq(recoveryCodes.codeHash, keyedHash(recoveryKey(deps), normal)),
            isNull(recoveryCodes.usedAt),
          ),
        )
        .returning({ id: recoveryCodes.id });
      if (used.length === 0) return { ok: false as const, reason: "invalid" as const };
      usedRecoveryCode = true;
      await writeAudit(tx, {
        actorId: userId,
        action: "two_factor.recovery_code_used",
        subjectType: "user",
        subjectId: userId,
      });
    }

    const elevated = await elevateSessionIn(tx, userId, currentTokenHash);
    if (!elevated) return { ok: false as const, reason: "no_session" as const };
    return {
      ok: true as const,
      rotated: elevated.rotated,
      oldHash: elevated.oldHash,
      usedRecoveryCode,
    };
  });
  if (!result.ok) return result;
  await cacheDelete(result.oldHash);
  await clearTwoFactorFailures({ userId }, deps);
  return { ok: true, rotated: result.rotated, usedRecoveryCode: result.usedRecoveryCode };
}

/** New recovery codes (the old ones stop working); requires a current TOTP code. */
export async function regenerateRecoveryCodes(
  userId: string,
  code: string,
  deps: TwoFactorDeps = {},
): Promise<ConfirmResult> {
  const guard = await guardTwoFactor({ userId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "locked", until: guard.until };
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, userId))
      .for("update");
    if (!row?.confirmedAt) return { ok: false, reason: "no_setup" };
    const secret = open(totpKey(deps), row.secretEnc);
    const step = secret ? verifyTotp(base32Decode(secret), code, nowS(), row.lastStep) : null;
    if (step === null) return { ok: false, reason: "invalid" };
    await tx.update(totpSecrets).set({ lastStep: step }).where(eq(totpSecrets.userId, userId));
    const codes = await storeRecoveryCodes(tx, userId, deps);
    await clearTwoFactorFailures({ userId }, deps);
    return { ok: true, recoveryCodes: codes };
  });
}

/**
 * Admin reset for a lost phone: removes TOTP, recovery codes and passkeys, signs the user out
 * everywhere, audit-logged. The router restricts it to super admins.
 */
export async function resetTwoFactor(actorId: string, userId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.delete(passkeys).where(eq(passkeys.userId, userId));
    await writeAudit(tx, {
      actorId,
      action: "two_factor.reset",
      subjectType: "user",
      subjectId: userId,
    });
  });
  await invalidateUserSessionsCore(userId);
}

/** Seeds a confirmed TOTP for a known secret (seed scripts only: demo and local staff). */
export async function seedConfirmedTotp(
  userId: string,
  secretBase32: string,
  deps: TwoFactorDeps = {},
): Promise<void> {
  const sealed = seal(totpKey(deps), secretBase32);
  await db()
    .insert(totpSecrets)
    .values({ userId, secretEnc: sealed, confirmedAt: clock.now() })
    .onConflictDoUpdate({
      target: totpSecrets.userId,
      set: { secretEnc: sealed, confirmedAt: clock.now(), lastStep: null },
    });
}

/**
 * The setup page's secret: the pending (unconfirmed) one if any, so a reload while scanning keeps
 * the same QR code; otherwise a new one. Refused once enrolled.
 */
export async function pendingTotpSetup(
  userId: string,
  account: string,
  deps: TwoFactorDeps = {},
): Promise<SetupResult> {
  const [row] = await db()
    .select()
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, userId))
    .limit(1);
  if (row?.confirmedAt) return { ok: false, reason: "already_enrolled" };
  const existing = row ? open(totpKey(deps), row.secretEnc) : null;
  if (existing) return { ok: true, secret: existing, uri: otpauthUri(existing, account) };
  return beginTotpSetup(userId, deps, account);
}

/** Right after a confirmed enrolment: the calling session is stepped up to verified. */
export async function stepUpSession(
  userId: string,
  currentTokenHash: string,
): Promise<RotatedSession | null> {
  const elevated = await db().transaction((tx) => elevateSessionIn(tx, userId, currentTokenHash));
  if (!elevated) return null;
  await cacheDelete(elevated.oldHash);
  return elevated.rotated;
}

const FINISH_TTL_S = 10 * 60;

/**
 * After a confirmed enrolment the page still has to show the recovery codes, so the session is
 * stepped up only when the user finishes. This short-lived token proves the confirm happened in
 * this very session: HMAC over user, session and expiry (sub-key "totp"), valid for 10 minutes.
 */
export function finishToken(
  userId: string,
  sessionTokenHash: string,
  nowSeconds: number,
  deps: TwoFactorDeps = {},
): string {
  const expires = nowSeconds + FINISH_TTL_S;
  const mac = keyedHash(totpKey(deps), `finish|${userId}|${sessionTokenHash}|${expires}`);
  return `${expires}.${mac}`;
}

export function verifyFinishToken(
  token: string,
  userId: string,
  sessionTokenHash: string,
  nowSeconds: number,
  deps: TwoFactorDeps = {},
): boolean {
  const [expiresText, mac] = token.split(".");
  if (!expiresText || !mac || !/^\d{1,12}$/.test(expiresText)) return false;
  const expires = Number(expiresText);
  if (nowSeconds > expires) return false;
  const expected = keyedHash(totpKey(deps), `finish|${userId}|${sessionTokenHash}|${expires}`);
  return expected.length === mac.length && timingSafeEqual(Buffer.from(expected), Buffer.from(mac));
}
