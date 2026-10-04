"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n/server";
import { guardSignUp } from "@/server/auth/abuse";
import { getActingUser } from "@/server/auth/acting-user";
import { verifyCaptcha } from "@/server/auth/captcha";
import {
  blockedState,
  captchaToken,
  echo,
  type FormState,
  fields,
  sendAfterResponse,
  sendVerificationCode,
} from "@/server/auth/form-kit";
import { requestContext } from "@/server/auth/request-context";
import { createSession, destroySession, getCurrentUser } from "@/server/auth/session";
import { twoFactorEnforced } from "@/server/auth/staff-session";
import { clock } from "@/server/clock";
import { applyAsTeacher } from "./apply";
import { sendTeacherEmail } from "./emails";
import { redeemTeacherInvite } from "./invites";
import { acceptTeacherTerms } from "./terms";

/**
 * The teacher application form (C1): the sign-up limits and captcha, then a new teacher account in
 * status `applied`, a session, the verification code and the "application received" email,
 * then two-factor enrolment before the email confirmation.
 * Signed-in visitors never apply (one account, one role).
 */
export async function applyTeacherAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await getCurrentUser()) redirect("/dashboard");
  const { t, locale } = await getDictionary();
  const raw = fields(formData);
  const { ip } = await requestContext();
  const guard = await guardSignUp({ ip });
  if (!("ok" in guard)) return { ...blockedState(guard, t, locale), values: echo(raw) };
  if (!(await verifyCaptcha(captchaToken(raw), ip))) {
    return { status: "error", message: t.auth.states.captchaFailed, values: echo(raw) };
  }
  const result = await applyAsTeacher(raw, { locale, now: clock.now() });
  if (!result.ok) {
    if (result.code === "duplicate") {
      return {
        status: "error",
        message: t.auth.errors.checkDetails,
        offerReset: true,
        values: echo(raw),
      };
    }
    const messages = {
      name: t.auth.errors.field.name,
      email: t.auth.errors.field.email,
      password: t.auth.errors.field.password,
      date_of_birth: t.teachers.apply.dobError,
      note: t.teachers.apply.noteError,
    };
    const fieldErrors = Object.fromEntries(result.fields.map((field) => [field, messages[field]]));
    return { status: "error", message: t.auth.errors.invalid, fieldErrors, values: echo(raw) };
  }
  await destroySession();
  await createSession(result.userId);
  await sendVerificationCode(result.userId, locale);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim() : null;
  sendAfterResponse(() => sendTeacherEmail(email, locale, locale, { kind: "applied", name }));
  // Teachers are staff: the session acts for no one until two-factor passes (A8), so enrolment
  // comes first and the email confirmation right after it.
  redirect(twoFactorEnforced() ? "/two-factor/setup?next=%2Fverify-email" : "/verify-email");
}

export type AcceptTermsActionResult = { ok: true } | { ok: false; reason: "stale" | "error" };

/** An approved teacher accepts the current terms (the version the page showed). */
export async function acceptTermsAction(versionId: string): Promise<AcceptTermsActionResult> {
  const user = await getActingUser();
  if (user?.role !== "teacher" || typeof versionId !== "string" || versionId.length > 64) {
    return { ok: false, reason: "error" };
  }
  const result = await acceptTeacherTerms(user.id, versionId);
  if (!result.ok)
    return { ok: false, reason: result.reason === "stale_version" ? "stale" : "error" };
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Redeems a teacher invitation (C1): the sign-up limits by IP (each try hashes a password), then
 * the approved teacher account, a session and two-factor enrolment. The token comes from the page
 * URL as a hidden field; a bad, used or expired one gets one message.
 */
export async function redeemInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await getCurrentUser()) redirect("/dashboard");
  const { t, locale } = await getDictionary();
  const raw = fields(formData);
  const { ip } = await requestContext();
  const guard = await guardSignUp({ ip });
  if (!("ok" in guard)) return { ...blockedState(guard, t, locale), values: echo(raw) };
  const result = await redeemTeacherInvite({
    token: typeof raw.token === "string" ? raw.token : "",
    password: typeof raw.password === "string" ? raw.password : "",
    dateOfBirth: typeof raw.date_of_birth === "string" ? raw.date_of_birth : "",
    locale,
  });
  if (!result.ok) {
    if (result.reason === "fields") {
      const messages = {
        password: t.auth.errors.field.password,
        date_of_birth: t.teachers.apply.dobError,
      };
      const fieldErrors = Object.fromEntries(
        result.fields.map((field) => [field, messages[field]]),
      );
      return { status: "error", message: t.auth.errors.invalid, fieldErrors, values: echo(raw) };
    }
    const message = result.reason === "taken" ? t.teachers.invite.taken : t.teachers.invite.invalid;
    return { status: "error", message, offerReset: result.reason === "taken" };
  }
  await destroySession();
  await createSession(result.userId);
  // Staff: two-factor enrolment before anything else (the email is already verified).
  redirect(twoFactorEnforced() ? "/two-factor/setup?next=%2Fdashboard" : "/dashboard");
}
