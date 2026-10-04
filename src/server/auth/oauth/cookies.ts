import "server-only";
import { cookies } from "next/headers";
import { clock } from "@/server/clock";
import { authKey } from "../keys";
import { open, seal } from "../secret-box";
import { type OAuthFlow, openFlow, sealFlow } from "./flow";
import { createPendingSignup, isPendingSignupLive } from "./pending-store";
import type { OAuthIdentity } from "./provider";

// The two short-lived cookies of Google sign-in, sealed with the "oauth" sub-key (AES-GCM):
// the flow (state, PKCE verifier, next) for the callback, and the pending identity of a new user
// for the completion page. The pending cookie is `__Host-` (a sibling subdomain cannot plant it)
// and names a one-time server row (A8 review L3).

const FLOW_COOKIE = "oauth";
const PENDING_COOKIE = "__Host-oauth_pending";
/** Pre-A8 name: never read, only deleted. */
const LEGACY_PENDING_COOKIE = "oauth_pending";
const FLOW_MAX_AGE_S = 10 * 60;
const PENDING_TTL_S = 15 * 60;

const nowS = () => Math.floor(Date.now() / 1000);

export async function setFlowCookie(flow: OAuthFlow, secure: boolean): Promise<void> {
  (await cookies()).set(FLOW_COOKIE, sealFlow(authKey("oauth"), flow), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/api/oauth",
    maxAge: FLOW_MAX_AGE_S,
  });
}

/** Reads and deletes the flow cookie: one callback per flow. */
export async function takeFlowCookie(): Promise<OAuthFlow | null> {
  const jar = await cookies();
  const value = jar.get(FLOW_COOKIE)?.value;
  jar.delete({ name: FLOW_COOKIE, path: "/api/oauth" });
  return value ? openFlow(authKey("oauth"), value, nowS()) : null;
}

export type PendingSignUp = {
  /** The one-time server row (`oauth_pending_signups`). */
  id: string;
  identity: OAuthIdentity;
  next: string;
  expiresAtS: number;
};

export async function setPendingCookie(identity: OAuthIdentity, next: string): Promise<void> {
  const expiresAtS = nowS() + PENDING_TTL_S;
  const id = await createPendingSignup(new Date(expiresAtS * 1000), clock.now());
  const pending: PendingSignUp = { id, identity, next, expiresAtS };
  (await cookies()).set(
    PENDING_COOKIE,
    seal(authKey("oauth"), JSON.stringify({ t: "pending", ...pending })),
    // `__Host-` needs Secure, Path=/ and no Domain (localhost counts as secure).
    { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: PENDING_TTL_S },
  );
}

export async function readPendingCookie(): Promise<PendingSignUp | null> {
  const value = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!value) return null;
  const plain = open(authKey("oauth"), value);
  if (!plain) return null;
  try {
    const pending = JSON.parse(plain) as PendingSignUp & { t?: unknown };
    if (pending.t !== "pending") return null;
    if (typeof pending.expiresAtS !== "number" || nowS() > pending.expiresAtS) return null;
    if (typeof pending.identity?.subject !== "string" || typeof pending.id !== "string")
      return null;
    return (await isPendingSignupLive(pending.id, clock.now())) ? pending : null;
  } catch {
    return null;
  }
}

export async function clearPendingCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(PENDING_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  jar.delete({ name: LEGACY_PENDING_COOKIE, path: "/" });
}
