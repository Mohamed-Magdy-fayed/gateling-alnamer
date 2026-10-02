import "server-only";
import { cookies, headers } from "next/headers";
import { serverEnv } from "@/server/env";
import { clientIp } from "@/server/request-ip";
import { issueDeviceCookie } from "./device-cookie";
import { authKey } from "./keys";

export type RequestContext = {
  /** Client IP (see `clientIp`); hashed before it goes anywhere near a key. */
  ip: string;
  /** The returning device's signed id; null when the request had no valid `did` cookie. */
  deviceId: string | null;
};

/**
 * Call at the top of an auth server action: reads the client IP and sets (or refreshes) the device
 * cookie. A device minted by this very request is not trusted for lockout keys, so a client that
 * drops its cookie is limited by its hashed IP instead of getting a fresh pair every attempt.
 */
export async function requestContext(): Promise<RequestContext> {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const env = serverEnv();
  const secure =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
    Boolean(env.VERCEL);
  const device = issueDeviceCookie(store, { key: authKey("did"), secure });
  return {
    ip: clientIp(requestHeaders, {
      VERCEL: env.VERCEL,
      TRUST_PROXY_HEADERS: process.env.TRUST_PROXY_HEADERS,
    }),
    deviceId: device.existing ? device.id : null,
  };
}
