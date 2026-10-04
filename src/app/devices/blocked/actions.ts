"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { format, formatDate } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { guardSupportRequest } from "@/server/auth/abuse";
import type { FormState } from "@/server/auth/actions";
import { requestContext } from "@/server/auth/request-context";
import { createSession, destroySession } from "@/server/auth/session";
import { clock } from "@/server/clock";
import { cairoDay } from "@/server/devices/day";
import { clearPreSession, getPreSession } from "@/server/devices/pre-session";
import { removeAndRegister } from "@/server/devices/service";
import { sendEvent } from "@/server/jobs/send";

const BLOCKED_PATH = "/devices/blocked";
const removeSchema = z.object({ deviceId: z.uuid() });

/**
 * Removes one of the student's devices (once a week) and registers this browser in one
 * transaction, then swaps the pre-session for a real session. Everything here is gated by the
 * pre-session, never by a session. This browser must be the one the pre-session was issued to.
 */
export async function removeDeviceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const pre = await getPreSession();
  if (!pre) redirect("/sign-in");
  const parsed = removeSchema.safeParse({ deviceId: formData.get("deviceId") });
  if (!parsed.success) redirect(BLOCKED_PATH);

  const device = await requestContext();
  if (device.deviceKey !== pre.deviceKey) redirect("/sign-in");

  const removal = await removeAndRegister({
    userId: pre.userId,
    deviceId: parsed.data.deviceId,
    currentDeviceKey: device.deviceKey,
    userAgent: device.userAgent,
    preSessionTokenHash: pre.tokenHash,
  });
  if (!removal.ok) {
    // The pre-session died (password reset, sign-out everywhere) or the account was suspended.
    if (removal.reason === "expired") redirect("/sign-in");
    if (removal.reason !== "throttled") redirect(BLOCKED_PATH);
    const { t, locale } = await getDictionary();
    return {
      status: "error",
      tone: "warning",
      message: format(t.devices.throttled, { date: formatDate(locale, removal.nextAt) }),
    };
  }

  // A session of a previous account on this browser is ended, not orphaned (A8 review L5).
  await destroySession();
  await createSession(pre.userId, { deviceId: removal.deviceId });
  await clearPreSession();
  redirect("/dashboard");
}

/**
 * Asks the admins (and later the linked parents) for help: 3 a day per student, 5 per IP, 20
 * platform-wide. The event id also lets Inngest drop a repeat for the same student on the same
 * Cairo day.
 */
export async function contactSupportAction(): Promise<FormState> {
  const pre = await getPreSession();
  if (!pre) redirect("/sign-in");
  const { t, locale } = await getDictionary();

  const { ip } = await requestContext();
  const guard = await guardSupportRequest({ userId: pre.userId, ip });
  if (!("ok" in guard)) {
    return { status: "error", tone: "warning", message: t.auth.states.rateLimited };
  }
  try {
    await sendEvent(
      "devices/support-request",
      { userId: pre.userId, locale },
      { id: `devices-support:${pre.userId}:${cairoDay(clock.now())}` },
    );
  } catch (error: unknown) {
    console.error(
      "Support request enqueue failed",
      error instanceof Error ? error.name : "unknown",
    );
    return { status: "error", message: t.devices.supportFailed };
  }
  return { status: "success", message: t.devices.supportSent };
}
