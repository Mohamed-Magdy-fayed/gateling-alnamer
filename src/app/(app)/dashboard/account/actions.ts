"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n/server";
import type { FormState } from "@/server/auth/actions";
import { getCurrentSession, invalidateUserSessions } from "@/server/auth/session";
import { passesTwoFactor } from "@/server/auth/staff-session";

/** Ends every other session of this account. Devices stay registered, so their slots stay used. */
export async function signOutOthersAction(): Promise<FormState> {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  // A staff session that has not passed two-factor cannot sign the owner's sessions out.
  if (!passesTwoFactor(session)) redirect("/two-factor");
  await invalidateUserSessions(session.user.id, { exceptTokenHash: session.tokenHash });
  revalidatePath("/dashboard/account");
  const { t } = await getDictionary();
  const message =
    session.user.role === "student"
      ? t.devices.signOutOthersDone
      : t.devices.signOutOthersDoneBasic;
  return { status: "success", message };
}
