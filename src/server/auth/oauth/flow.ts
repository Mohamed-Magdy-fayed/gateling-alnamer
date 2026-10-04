import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { open, seal } from "../secret-box";

// The state an OAuth sign-in carries between the start route and the callback: a random `state`
// (CSRF), the PKCE verifier and where to go next, sealed into a short-lived HttpOnly cookie.

const FLOW_TTL_S = 10 * 60;

export type OAuthFlow = { state: string; verifier: string; next: string; expiresAtS: number };

const random = () => randomBytes(32).toString("base64url");

export function newFlow(next: string, nowS: number): OAuthFlow {
  return { state: random(), verifier: random(), next, expiresAtS: nowS + FLOW_TTL_S };
}

/** RFC 7636 S256: base64url(sha256(verifier)). */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function statesMatch(expected: string, received: string): boolean {
  if (!expected || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function sealFlow(key: Buffer, flow: OAuthFlow): string {
  return seal(key, JSON.stringify(flow));
}

/** The flow from its cookie, or null when missing, tampered, malformed or expired. */
export function openFlow(key: Buffer, sealed: string, nowS: number): OAuthFlow | null {
  const plain = open(key, sealed);
  if (!plain) return null;
  try {
    const flow = JSON.parse(plain) as Partial<OAuthFlow>;
    if (
      typeof flow.state !== "string" ||
      typeof flow.verifier !== "string" ||
      typeof flow.next !== "string" ||
      typeof flow.expiresAtS !== "number" ||
      nowS > flow.expiresAtS
    ) {
      return null;
    }
    return flow as OAuthFlow;
  } catch {
    return null;
  }
}
