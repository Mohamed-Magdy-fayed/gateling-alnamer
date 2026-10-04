"use server";

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { guardPasskeyOptions } from "@/server/auth/abuse";
import {
  authenticationOptions,
  finishRegistration,
  registrationOptions,
  removePasskey,
  verifyPasskeyChallenge,
} from "@/server/auth/passkeys";
import { getCurrentSession, setSessionCookie } from "@/server/auth/session";
import { staffSessionOrNull } from "@/server/auth/staff-session";
import {
  confirmTotpSetup,
  finishToken,
  regenerateRecoveryCodes,
  stepUpSession,
  twoFactorStatus,
  verifyChallenge,
  verifyFinishToken,
} from "@/server/auth/two-factor";
import { currentRelyingParty } from "@/server/auth/webauthn-rp";
import { clock } from "@/server/clock";

const MAX_INPUT = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowSeconds = () => Math.floor(clock.now().getTime() / 1000);

export type TwoFactorActionResult =
  | { ok: true; recoveryCodes?: string[]; finish?: string }
  | { ok: false; reason: "invalid" | "locked" | "error" };

/** An active staff session (the two-factor screens: not verified yet is fine). */
async function staffSession() {
  return staffSessionOrNull(await getCurrentSession(), { verified: false });
}

/**
 * Confirms enrolment with the first app code, then steps the session up (the code proved the
 * second factor) and returns the recovery codes to show once.
 */
export async function confirmSetupAction(code: string): Promise<TwoFactorActionResult> {
  const session = await staffSession();
  if (!session || typeof code !== "string" || code.length > MAX_INPUT) {
    return { ok: false, reason: "error" };
  }
  const result = await confirmTotpSetup(session.user.id, session.tokenHash, code);
  if (!result.ok) {
    return { ok: false, reason: result.reason === "locked" ? "locked" : "invalid" };
  }
  // The session is stepped up on Finish, after the codes were shown (a cookie change now would
  // re-render the page and skip them); the finish token proves the confirm happened here.
  const finish = finishToken(session.user.id, session.tokenHash, nowSeconds());
  return { ok: true, recoveryCodes: result.recoveryCodes, finish };
}

/** Finish enrolment: the session (that confirmed) becomes two-factor verified. */
export async function finishSetupAction(token: string): Promise<TwoFactorActionResult> {
  const session = await staffSession();
  if (!session || typeof token !== "string" || token.length > 128) {
    return { ok: false, reason: "error" };
  }
  if (!verifyFinishToken(token, session.user.id, session.tokenHash, nowSeconds())) {
    return { ok: false, reason: "error" };
  }
  const { enrolled } = await twoFactorStatus(session.user.id);
  if (!enrolled) return { ok: false, reason: "error" };
  const rotated = await stepUpSession(session.user.id, session.tokenHash);
  if (!rotated) return { ok: false, reason: "error" };
  await setSessionCookie(rotated.token, rotated.expiresAt);
  return { ok: true };
}

/** The sign-in challenge: an app code or a recovery code; on success the session is verified. */
export async function challengeAction(input: string): Promise<TwoFactorActionResult> {
  const session = await staffSession();
  if (!session || typeof input !== "string" || input.length > MAX_INPUT) {
    return { ok: false, reason: "error" };
  }
  const result = await verifyChallenge(session.user.id, session.tokenHash, input);
  if (!result.ok) {
    if (result.reason === "locked") return { ok: false, reason: "locked" };
    return { ok: false, reason: result.reason === "invalid" ? "invalid" : "error" };
  }
  await setSessionCookie(result.rotated.token, result.rotated.expiresAt);
  return { ok: true };
}

/** New recovery codes from the account page (needs a current app code; the session is verified). */
export async function regenerateCodesAction(code: string): Promise<TwoFactorActionResult> {
  const session = await verifiedStaff();
  if (!session || typeof code !== "string" || code.length > MAX_INPUT) {
    return { ok: false, reason: "error" };
  }
  const result = await regenerateRecoveryCodes(session.user.id, code);
  if (!result.ok) return { ok: false, reason: result.reason === "locked" ? "locked" : "invalid" };
  return { ok: true, recoveryCodes: result.recoveryCodes };
}

// Passkeys (A4b). The browser runs the WebAuthn ceremony; these actions issue and check challenges.

/** Sign-in challenge options for an unverified staff session with passkeys; null otherwise. */
export async function passkeyOptionsAction(): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const session = await staffSession();
  const rp = await currentRelyingParty();
  if (!session || !rp) return null;
  if (!("ok" in (await guardPasskeyOptions({ userId: session.user.id })))) return null;
  return authenticationOptions(session.user.id, rp);
}

/** Checks the passkey assertion; on success the session is verified. */
export async function passkeyVerifyAction(
  response: AuthenticationResponseJSON,
): Promise<TwoFactorActionResult> {
  const session = await staffSession();
  const rp = await currentRelyingParty();
  if (!session || !rp || typeof response?.id !== "string") return { ok: false, reason: "error" };
  const result = await verifyPasskeyChallenge(session.user.id, session.tokenHash, response, rp);
  if (!result.ok) return { ok: false, reason: result.reason === "locked" ? "locked" : "invalid" };
  await setSessionCookie(result.rotated.token, result.rotated.expiresAt);
  return { ok: true };
}

/** An active staff session that passed two-factor (account-page actions). */
async function verifiedStaff() {
  return staffSessionOrNull(await getCurrentSession(), { verified: true });
}

/** Options to add a passkey from the account page (verified staff only). */
export async function addPasskeyOptionsAction(): Promise<PublicKeyCredentialCreationOptionsJSON | null> {
  const session = await verifiedStaff();
  const rp = await currentRelyingParty();
  if (!session || !rp) return null;
  if (!("ok" in (await guardPasskeyOptions({ userId: session.user.id })))) return null;
  return registrationOptions(
    { id: session.user.id, name: session.user.name, email: session.user.email },
    rp,
  );
}

export async function addPasskeyFinishAction(
  response: RegistrationResponseJSON,
): Promise<TwoFactorActionResult> {
  const session = await verifiedStaff();
  const rp = await currentRelyingParty();
  if (!session || !rp || typeof response?.id !== "string") return { ok: false, reason: "error" };
  const result = await finishRegistration(session.user.id, response, rp, null);
  if (!result.ok) return { ok: false, reason: "invalid" };
  revalidatePath("/dashboard/account");
  return { ok: true };
}

export async function removePasskeyAction(passkeyId: string): Promise<TwoFactorActionResult> {
  const session = await verifiedStaff();
  if (!session || typeof passkeyId !== "string" || !UUID.test(passkeyId)) {
    return { ok: false, reason: "error" };
  }
  const removed = await removePasskey(session.user.id, passkeyId);
  revalidatePath("/dashboard/account");
  return removed ? { ok: true } : { ok: false, reason: "invalid" };
}
