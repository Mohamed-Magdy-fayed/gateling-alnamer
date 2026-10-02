"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { format, formatDate } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { guardSupportRequest } from "@/server/auth/abuse";
import type { FormState } from "@/server/auth/actions";
import { createSession } from "@/server/auth/session";
import { clearPreSession, getPreSession } from "@/server/devices/pre-session";
import { registerOrBlock, removeDevice } from "@/server/devices/service";
import { sendEvent } from "@/server/jobs/send";

const BLOCKED_PATH = "/devices/blocked";
const removeSchema = z.object({ deviceId: z.uuid() });

/**
 * Removes one of the student's devices (once a week), then swaps the pre-session for a real
 * session on this browser. Everything here is gated by the pre-session, never by a session.
 */
export async function removeDeviceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const pre = await getPreSession();
  if (!pre) redirect("/sign-in");
  const parsed = removeSchema.safeParse({ deviceId: formData.get("deviceId") });
  if (!parsed.success) redirect(BLOCKED_PATH);

  const removal = await removeDevice({
    userId: pre.userId,
    deviceId: parsed.data.deviceId,
    currentDeviceKey: pre.deviceKey,
  });
  if (!removal.ok) {
    if (removal.reason !== "throttled") redirect(BLOCKED_PATH);
    const { t, locale } = await getDictionary();
    return {
      status: "error",
      tone: "warning",
      message: format(t.devices.throttled, { date: formatDate(locale, removal.nextAt) }),
    };
  }

  const userAgent = (await headers()).get("user-agent");
  const registered = await registerOrBlock(pre.userId, pre.deviceKey, userAgent);
  if (registered.outcome === "block" || !registered.deviceId) redirect(BLOCKED_PATH);
  await createSession(pre.userId, { deviceId: registered.deviceId });
  await clearPreSession();
  redirect("/dashboard");
}

/** Asks the admins (and later the linked parents) for help, at most 3 a day per student. */
export async function contactSupportAction(): Promise<FormState> {
  const pre = await getPreSession();
  if (!pre) redirect("/sign-in");
  const { t, locale } = await getDictionary();

  const guard = await guardSupportRequest({ userId: pre.userId });
  if (!("ok" in guard)) {
    return { status: "error", tone: "warning", message: t.auth.states.rateLimited };
  }
  try {
    await sendEvent("devices/support-request", { userId: pre.userId, locale });
  } catch (error: unknown) {
    // The answer stays the same: the student cannot fix a mail failure, and nothing here is secret.
    console.error(
      "Support request enqueue failed",
      error instanceof Error ? error.name : "unknown",
    );
  }
  return { status: "success", message: t.devices.supportSent };
}
