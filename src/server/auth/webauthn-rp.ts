import "server-only";
import { headers } from "next/headers";
import { serverEnv } from "@/server/env";
import { isLocalHostname } from "@/server/local-hosts";
import type { RelyingParty } from "./passkeys";

/** The relying party for an origin: the configured site, or any localhost port when not deployed. */
export function relyingPartyFor(
  origin: string | null,
  env: { BASE_URL?: string; VERCEL?: string; APP_MODE?: string } = serverEnv(),
): RelyingParty | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const configured = env.BASE_URL ? new URL(env.BASE_URL).origin : null;
  if (configured && url.origin === configured) return { rpID: url.hostname, origin: url.origin };
  // Localhost origins only off Vercel and never in live mode (a real deployment uses BASE_URL).
  if (!env.VERCEL && env.APP_MODE !== "live" && isLocalHostname(url.hostname))
    return { rpID: url.hostname, origin: url.origin };
  return null;
}

/** The relying party of the current request (server actions carry an Origin header). */
export async function currentRelyingParty(): Promise<RelyingParty | null> {
  const list = await headers();
  return relyingPartyFor(list.get("origin"));
}
