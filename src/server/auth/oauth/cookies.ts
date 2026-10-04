import "server-only";
import { cookies } from "next/headers";
import { authKey } from "../keys";
import { open, seal } from "../secret-box";
import { type OAuthFlow, openFlow, sealFlow } from "./flow";
import type { OAuthIdentity } from "./provider";

// The two short-lived cookies of Google sign-in, sealed with the "oauth" sub-key (AES-GCM):
// the flow (state, PKCE verifier, next) for the callback, and the pending identity of a new user
// for the completion page.

const FLOW_COOKIE = "oauth";
const PENDING_COOKIE = "oauth_pending";
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

export type PendingSignUp = { identity: OAuthIdentity; next: string; expiresAtS: number };

export async function setPendingCookie(
  identity: OAuthIdentity,
  next: string,
  secure: boolean,
): Promise<void> {
  const pending: PendingSignUp = { identity, next, expiresAtS: nowS() + PENDING_TTL_S };
  (await cookies()).set(PENDING_COOKIE, seal(authKey("oauth"), JSON.stringify(pending)), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: PENDING_TTL_S,
  });
}

export async function readPendingCookie(): Promise<PendingSignUp | null> {
  const value = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!value) return null;
  const plain = open(authKey("oauth"), value);
  if (!plain) return null;
  try {
    const pending = JSON.parse(plain) as PendingSignUp;
    if (typeof pending.expiresAtS !== "number" || nowS() > pending.expiresAtS) return null;
    if (typeof pending.identity?.subject !== "string") return null;
    return pending;
  } catch {
    return null;
  }
}

export async function clearPendingCookie(): Promise<void> {
  (await cookies()).delete({ name: PENDING_COOKIE, path: "/" });
}
