import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { clock } from "@/server/clock";
import { PENDING_RESET_TTL_MS } from "@/server/config/policy";
import { serverEnv } from "@/server/env";
import { authKey } from "./keys";

/**
 * The password-reset screens need to know which account a code was requested for without the email in
 * a URL or in any response. It lives in a short-lived, signed, HttpOnly cookie that only the server
 * reads. The same cookie is set for known and unknown emails, so it says nothing about the account.
 */
export const PENDING_RESET_COOKIE = "rp";

export type PendingReset = { email: string; issuedAt: number };

const mac = (payload: string, key: Buffer | string): string =>
  createHmac("sha256", key).update(`pending-reset:${payload}`).digest("base64url");

/** `<base64url(json)>.<base64url HMAC-SHA256>`; the email is encoded, not readable plain text. */
export function signPendingReset(value: PendingReset, key: Buffer | string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${mac(payload, key)}`;
}

function isPending(value: unknown): value is PendingReset {
  if (typeof value !== "object" || value === null) return false;
  const { email, issuedAt } = value as Record<string, unknown>;
  return typeof email === "string" && typeof issuedAt === "number" && Number.isFinite(issuedAt);
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

/** Server actions only: remembers that a reset code was just requested for `email`. */
export async function setPendingReset(email: string): Promise<void> {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const env = serverEnv();
  const secure =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
    Boolean(env.VERCEL);
  const value = signPendingReset({ email, issuedAt: clock.now().getTime() }, pendingKey());
  store.set(PENDING_RESET_COOKIE, value, {
    httpOnly: true,
    secure,
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
  store.delete(PENDING_RESET_COOKIE);
}
