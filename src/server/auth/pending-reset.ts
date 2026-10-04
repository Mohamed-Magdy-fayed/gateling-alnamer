import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { clock } from "@/server/clock";
import { PENDING_RESET_TTL_MS } from "@/server/config/policy";
import { authKey, keyedHash } from "./keys";

/**
 * The password-reset screens need to know which account a code was requested for without the email in
 * a URL or in any response. It lives in a short-lived, signed, HttpOnly cookie that only the server
 * reads. The same cookie is set for known and unknown emails, so it says nothing about the account.
 */
export const PENDING_RESET_COOKIE = "__Host-rp";
/** Pre-A8 name: never read, only deleted. */
const LEGACY_PENDING_RESET_COOKIE = "rp";

/**
 * `nonce` is random per reset request: the codes sent for it carry its keyed hash, so only this
 * browser's guesses count against them (A8 review L2).
 */
export type PendingReset = { email: string; issuedAt: number; nonce: string };

/** A new requester nonce for a reset request. */
export const newResetNonce = (): string => randomBytes(18).toString("base64url");

/** What a reset code row stores for its requester: never the nonce itself. */
export const resetRequesterHash = (nonce: string, key: Buffer = authKey("rp")): string =>
  keyedHash(key, `requester:${nonce}`);

const mac = (payload: string, key: Buffer | string): string =>
  createHmac("sha256", key).update(`pending-reset:${payload}`).digest("base64url");

/** `<base64url(json)>.<base64url HMAC-SHA256>`; the email is encoded, not readable plain text. */
export function signPendingReset(value: PendingReset, key: Buffer | string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${mac(payload, key)}`;
}

function isPending(value: unknown): value is PendingReset {
  if (typeof value !== "object" || value === null) return false;
  const { email, issuedAt, nonce } = value as Record<string, unknown>;
  return (
    typeof email === "string" &&
    typeof nonce === "string" &&
    nonce.length > 0 &&
    typeof issuedAt === "number" &&
    Number.isFinite(issuedAt)
  );
}

/** The pending reset when the cookie is correctly signed and not older than the TTL, else null. */
export function parsePendingReset(
  value: string | undefined,
  key: Buffer | string,
  now: Date,
): PendingReset | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(payload, key));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!isPending(parsed)) return null;
    return now.getTime() - parsed.issuedAt > PENDING_RESET_TTL_MS ? null : parsed;
  } catch {
    return null;
  }
}

const pendingKey = () => authKey("rp");

/** Server actions only: remembers that a reset code was just requested for `email` by this browser. */
export async function setPendingReset(email: string, nonce: string): Promise<void> {
  const store = await cookies();
  const value = signPendingReset({ email, issuedAt: clock.now().getTime(), nonce }, pendingKey());
  store.set(PENDING_RESET_COOKIE, value, {
    httpOnly: true,
    // `__Host-` (A8 review L3): Secure, Path=/, no Domain, so a sibling subdomain cannot plant
    // it. Localhost counts as secure.
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(PENDING_RESET_TTL_MS / 1000),
  });
}

/** Safe in server components, route handlers and actions. */
export async function readPendingReset(): Promise<PendingReset | null> {
  const store = await cookies();
  return parsePendingReset(store.get(PENDING_RESET_COOKIE)?.value, pendingKey(), clock.now());
}

export async function clearPendingReset(): Promise<void> {
  const store = await cookies();
  store.set(PENDING_RESET_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  store.delete(LEGACY_PENDING_RESET_COOKIE);
}
