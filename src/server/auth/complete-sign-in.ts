import "server-only";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/server/devices/next-path";
import { gateDevice } from "@/server/devices/sign-in";
import { markDeviceSeen } from "./known-device";
import type { RequestContext } from "./request-context";
import { createSession, destroySession } from "./session";

/**
 * The end of every sign-in (password or Google), once the user is known: the old session never
 * survives (fixation, switching accounts), the device limit decides for students (over the limit
 * in strict mode means a pre-session and device management, never a session), then the session.
 * Staff meet two-factor on the next page through the page guard.
 */
export async function completeSignIn(
  userId: string,
  device: Pick<RequestContext, "deviceKey" | "userAgent" | "secure">,
  next: string | undefined,
): Promise<never> {
  await destroySession();
  const gate = await gateDevice(userId, {
    deviceKey: device.deviceKey,
    userAgent: device.userAgent,
    secure: device.secure,
  });
  if (gate.kind === "blocked") redirect("/devices/blocked");
  await createSession(userId, { deviceId: gate.deviceId });
  await markDeviceSeen(device.deviceKey);
  // The over-limit notice lives on the dashboard, so it wins over `next`.
  redirect(gate.overLimit ? "/dashboard?notice=device-over" : safeNextPath(next));
}
