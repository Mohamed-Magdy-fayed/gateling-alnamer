import "server-only";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { writeAudit } from "@/server/audit/repository";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { passkeys, webauthnChallenges } from "@/server/db/schema";
import { type AbuseDeps, clearTwoFactorFailures, guardTwoFactor } from "./abuse";
import { cacheDelete } from "./session-cache";
import { elevateSessionIn, type RotatedSession } from "./session-rotate";

// Passkeys as the second factor for staff (A4b), with @simplewebauthn. Challenges live in the
// database and are consumed on use, so an assertion cannot be replayed even when the
// authenticator's signature counter stays at 0.

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 10;
const RP_NAME = "Al-Namer";

/** The relying party: the site's host and origin, resolved by the caller from the request. */
export type RelyingParty = { rpID: string; origin: string };

export type PasskeyDeps = AbuseDeps & {
  verifyRegistration?: typeof verifyRegistrationResponse;
  verifyAuthentication?: typeof verifyAuthenticationResponse;
};

type Purpose = "register" | "authenticate";

async function storeChallenge(userId: string, purpose: Purpose, challenge: string) {
  const now = clock.now();
  await db()
    .delete(webauthnChallenges)
    .where(and(eq(webauthnChallenges.userId, userId), eq(webauthnChallenges.purpose, purpose)));
  await db()
    .insert(webauthnChallenges)
    .values({
      id: uuidv7(),
      userId,
      purpose,
      challenge,
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    });
}

/** The challenge the browser signed (clientDataJSON.challenge), or null when it cannot be read. */
function signedChallenge(response: { response?: { clientDataJSON?: unknown } }): string | null {
  const raw = response.response?.clientDataJSON;
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const challenge = (data as { challenge?: unknown }).challenge;
    return typeof challenge === "string" ? challenge : null;
  } catch {
    return null;
  }
}

/**
 * Takes (deletes) the user's live challenge for this purpose: the one the browser signed when it
 * can be read (so two tabs never consume each other's), otherwise the latest. Null when none.
 */
async function consumeChallenge(
  userId: string,
  purpose: Purpose,
  signed: string | null,
): Promise<string | null> {
  const [row] = await db()
    .delete(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.userId, userId),
        eq(webauthnChallenges.purpose, purpose),
        gt(webauthnChallenges.expiresAt, clock.now()),
        signed ? eq(webauthnChallenges.challenge, signed) : undefined,
      ),
    )
    .returning({ challenge: webauthnChallenges.challenge });
  return row?.challenge ?? null;
}

export type PasskeyRow = {
  id: string;
  name: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export async function listPasskeys(userId: string): Promise<PasskeyRow[]> {
  return db()
    .select({
      id: passkeys.id,
      name: passkeys.name,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(desc(passkeys.createdAt));
}

/** Options for adding a passkey to a (verified) staff account. */
export async function registrationOptions(
  user: { id: string; name: string; email: string | null },
  rp: RelyingParty,
): Promise<PublicKeyCredentialCreationOptionsJSON | null> {
  const existing = await db()
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id));
  if (existing.length >= MAX_PASSKEYS) return null;
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: user.email ?? user.id,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({
      id: row.credentialId,
      transports: row.transports ?? undefined,
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await storeChallenge(user.id, "register", options.challenge);
  return options;
}

export type RegisterResult = { ok: true } | { ok: false; reason: "invalid" | "expired" | "limit" };

/** Verifies the browser's registration response and stores the passkey (audit-logged). */
export async function finishRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  rp: RelyingParty,
  name: string | null,
  deps: PasskeyDeps = {},
): Promise<RegisterResult> {
  const challenge = await consumeChallenge(userId, "register", signedChallenge(response));
  if (!challenge) return { ok: false, reason: "expired" };
  const verify = deps.verifyRegistration ?? verifyRegistrationResponse;
  const result = await verify({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: false,
  }).catch(() => null);
  if (!result?.verified) return { ok: false, reason: "invalid" };
  const { credential } = result.registrationInfo;
  return db().transaction(async (tx) => {
    const count = await tx
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));
    if (count.length >= MAX_PASSKEYS) return { ok: false as const, reason: "limit" as const };
    // A credential id already stored (another account, or a race) is refused, not thrown.
    const inserted = await tx
      .insert(passkeys)
      .values({
        id: uuidv7(),
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports ?? null,
        name: name?.slice(0, 60) || null,
      })
      .onConflictDoNothing({ target: passkeys.credentialId })
      .returning({ id: passkeys.id });
    if (inserted.length === 0) return { ok: false as const, reason: "invalid" as const };
    await writeAudit(tx, {
      actorId: userId,
      action: "two_factor.passkey_added",
      subjectType: "user",
      subjectId: userId,
    });
    return { ok: true as const };
  });
}

/** Options for the sign-in challenge; null when the user has no passkey. */
export async function authenticationOptions(
  userId: string,
  rp: RelyingParty,
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const rows = await db()
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
  if (rows.length === 0) return null;
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: rows.map((row) => ({
      id: row.credentialId,
      transports: row.transports ?? undefined,
    })),
    userVerification: "preferred",
  });
  await storeChallenge(userId, "authenticate", options.challenge);
  return options;
}

export type PasskeyChallengeResult =
  | { ok: true; rotated: RotatedSession }
  | { ok: false; reason: "invalid" | "expired" | "locked" | "no_session" };

/**
 * The passkey as the second factor: the user's own credential, the consumed challenge, a counter
 * that never goes backwards; then the calling session is stepped up like a TOTP pass.
 */
export async function verifyPasskeyChallenge(
  userId: string,
  currentTokenHash: string,
  response: AuthenticationResponseJSON,
  rp: RelyingParty,
  deps: PasskeyDeps = {},
): Promise<PasskeyChallengeResult> {
  const guard = await guardTwoFactor({ userId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "locked" };
  const challenge = await consumeChallenge(userId, "authenticate", signedChallenge(response));
  if (!challenge) return { ok: false, reason: "expired" };
  const [row] = await db()
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.userId, userId), eq(passkeys.credentialId, response.id)))
    .limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  const verify = deps.verifyAuthentication ?? verifyAuthenticationResponse;
  const result = await verify({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: {
      id: row.credentialId,
      publicKey: new Uint8Array(Buffer.from(row.publicKey, "base64url")),
      counter: row.counter,
      transports: row.transports ?? undefined,
    },
    requireUserVerification: false,
  }).catch(() => null);
  if (!result?.verified) return { ok: false, reason: "invalid" };
  const { newCounter } = result.authenticationInfo;
  // A counter that moves backwards (when the authenticator keeps one) means a cloned key.
  if (row.counter > 0 && newCounter <= row.counter) return { ok: false, reason: "invalid" };
  const elevated = await db().transaction(async (tx) => {
    await tx
      .update(passkeys)
      .set({ counter: newCounter, lastUsedAt: clock.now() })
      .where(eq(passkeys.id, row.id));
    return elevateSessionIn(tx, userId, currentTokenHash);
  });
  if (!elevated) return { ok: false, reason: "no_session" };
  await cacheDelete(elevated.oldHash);
  await clearTwoFactorFailures({ userId }, deps);
  return { ok: true, rotated: elevated.rotated };
}

/** Removes one of the user's passkeys (audit-logged). */
export async function removePasskey(userId: string, passkeyId: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    const removed = await tx
      .delete(passkeys)
      .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
      .returning({ id: passkeys.id });
    if (removed.length === 0) return false;
    await writeAudit(tx, {
      actorId: userId,
      action: "two_factor.passkey_removed",
      subjectType: "user",
      subjectId: userId,
    });
    return true;
  });
}
