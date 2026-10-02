import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { requestContext } from "@/server/auth/request-context";
import { attachDeviceToSession, destroySession, getCurrentSession } from "@/server/auth/session";
import { safeNextPath } from "@/server/devices/next-path";
import { issuePreSession } from "@/server/devices/pre-session";
import { assertActiveDevice, registerOrBlock } from "@/server/devices/service";

/**
 * The device check for a signed-in student whose session has no active device (a session from
 * before the limit existed, or one whose device was revoked). It is an auth route, so it may set
 * the `did` cookie. It registers this browser and binds the current session to it; when the limit
 * blocks it, the session ends and a pre-session leads to device management.
 */
export async function GET(request: NextRequest): Promise<never> {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");

  const check = await assertActiveDevice({
    role: session.user.role,
    deviceId: session.deviceId,
  });
  if (check.ok) redirect(next);

  const device = await requestContext();
  const result = await registerOrBlock(session.user.id, device.deviceKey, device.userAgent);
  if (result.outcome === "block" || !result.deviceId) {
    await destroySession();
    await issuePreSession(session.user.id, device.deviceKey, { secure: device.secure });
    redirect("/devices/blocked");
  }
  await attachDeviceToSession(result.deviceId);
  redirect(next);
}
