"use server";

import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n/server";
import { clock } from "@/server/clock";
import type { FormState } from "../actions";
import { completeSignIn } from "../complete-sign-in";
import { requestContext } from "../request-context";
import { clearPendingCookie, readPendingCookie } from "./cookies";
import { completeGoogleSignUp } from "./decide";

type FieldKey = "name" | "date_of_birth" | "guardian_consent" | "role";

/** Creates the account of a new Google user (from the sealed pending identity), then signs in. */
export async function completeGoogleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t, locale } = await getDictionary();
  const pending = await readPendingCookie();
  if (!pending) redirect("/sign-in?notice=google-failed");
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  const values = {
    name: text("name"),
    role: text("role"),
    date_of_birth: text("date_of_birth"),
    guardian_consent: text("guardian_consent"),
  };
  const result = await completeGoogleSignUp(
    pending.identity,
    {
      name: values.name,
      role: values.role === "parent" ? "parent" : "student",
      dateOfBirth: values.date_of_birth,
      guardianConsent: values.guardian_consent === "on",
    },
    { locale, now: clock.now() },
  );
  if (!result.ok) {
    if ("decision" in result) {
      await clearPendingCookie();
      if (result.decision.kind === "signin") {
        return completeSignIn(result.decision.userId, await requestContext(), pending.next);
      }
      redirect(
        result.decision.kind === "needs_password"
          ? "/sign-in?notice=google-password"
          : "/sign-in?notice=google-failed",
      );
    }
    const fieldErrors: Partial<Record<FieldKey, string>> = {};
    for (const field of result.fields) {
      if (field === "role") continue;
      const reason = result.reasons?.[field] as keyof typeof t.auth.errors.field | undefined;
      const key = (reason ?? field) as keyof typeof t.auth.errors.field;
      fieldErrors[field as FieldKey] = t.auth.errors.field[key];
    }
    return { status: "error", message: t.auth.errors.invalid, fieldErrors, values };
  }
  await clearPendingCookie();
  return completeSignIn(result.userId, await requestContext(), pending.next);
}
