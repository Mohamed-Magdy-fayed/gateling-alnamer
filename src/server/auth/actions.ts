"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Dictionary } from "@/i18n/ar";
import { format, formatTime, isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { credentials, users } from "@/server/db/schema";
import { sendEvent } from "@/server/jobs/send";
import {
  clearSignInFailures,
  type GuardResult,
  guardCodeSend,
  guardCodeVerify,
  guardSignIn,
  guardSignUp,
} from "./abuse";
import { verifyCaptcha } from "./captcha";
import { issueCode, issueCodeDecoy, verifyCode, verifyCodeDecoy } from "./codes";
import { authenticate } from "./credentials";
import { hashPassword } from "./password";
import { requestContext } from "./request-context";
import { createSession, destroySession, invalidateUserSessions } from "./session";
import { type SignUpField, signUpUser } from "./sign-up";

export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  email?: string;
  /** Per-field messages (already translated) for the sign-up form. */
  fieldErrors?: Partial<Record<SignUpField, string>>;
  /** Set when the form-level error should offer the forgot-password link. */
  offerReset?: boolean;
  /** Non-secret values echoed back so a failed submit does not clear the form. */
  values?: Record<string, string>;
  /** Epoch ms when a lockout or rate limit ends; the form keeps its submit button disabled until then. */
  retryAt?: number;
  /** Set when sign-in needs a captcha: the form shows the widget and the next submit carries a token. */
  captchaRequired?: boolean;
};

type Blocked = Exclude<GuardResult, { ok: true }>;

/**
 * The one message for a guard block. A captcha step-up shows the captchaFailed copy and tells the
 * form to render the widget; everything here depends only on counters, never on whether an account
 * exists.
 */
function blockedState(blocked: Blocked, t: Dictionary, locale: Locale): FormState {
  const retryAt = blocked.until?.getTime();
  if (blocked.blocked === "locked") {
    const time = formatTime(locale, blocked.until ?? clock.now());
    return {
      status: "error",
      message: format(t.auth.states.lockout, { time }),
      offerReset: true,
      retryAt,
    };
  }
  if (blocked.blocked === "rateLimited") {
    return { status: "error", message: t.auth.states.rateLimited, retryAt };
  }
  return { status: "error", message: t.auth.states.captchaFailed, captchaRequired: true };
}

function captchaToken(raw: Record<string, unknown>): string | undefined {
  return typeof raw.captcha_token === "string" ? raw.captcha_token : undefined;
}

const email = z.string().trim().pipe(z.email()).pipe(z.string().max(254));
const password = z.string().min(8).max(128);

const signInSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});
const forgotSchema = z.object({ email });
const resetSchema = z.object({ email, code: z.string().regex(/^\d{6}$/), password });

function fields(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

const ECHOED_FIELDS = ["name", "email", "username", "role", "date_of_birth", "guardian_consent"];

function echo(raw: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ECHOED_FIELDS) {
    const value = raw[key];
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t, locale } = await getDictionary();
  const raw = fields(formData);
  const { ip } = await requestContext();
  const guard = await guardSignUp({ ip });
  if (!("ok" in guard)) return { ...blockedState(guard, t, locale), values: echo(raw) };
  if (!(await verifyCaptcha(captchaToken(raw), ip))) {
    return { status: "error", message: t.auth.states.captchaFailed, values: echo(raw) };
  }
  const result = await signUpUser(raw, { locale, now: clock.now() });
  if (!result.ok) {
    if (result.code === "duplicate") {
      return {
        status: "error",
        message: t.auth.errors.checkDetails,
        offerReset: true,
        values: echo(raw),
      };
    }
    const fieldErrors: Partial<Record<SignUpField, string>> = {};
    for (const field of result.fields) {
      // `role` is a radio with a default, so it only fails on a forged post: no field to point at.
      if (field === "role") continue;
      const reason = result.reasons?.[field];
      fieldErrors[field] = t.auth.errors.field[reason ?? field];
    }
    return { status: "error", message: t.auth.errors.invalid, fieldErrors, values: echo(raw) };
  }

  await createSession(result.userId);
  redirect("/dashboard");
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t, locale } = await getDictionary();
  const raw = fields(formData);
  const device = await requestContext();
  const failed: FormState = {
    status: "error",
    message: t.auth.errors.credentials,
    values: typeof raw.identifier === "string" ? { identifier: raw.identifier } : {},
  };
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return failed;

  const who = { identifier: parsed.data.identifier, ...device };
  const guard = await guardSignIn({ ...who, captchaToken: captchaToken(raw) });
  if (!("ok" in guard)) return { ...blockedState(guard, t, locale), values: failed.values };

  const userId = await authenticate(parsed.data.identifier, parsed.data.password);
  if (!userId) return failed;
  await clearSignInFailures(who);

  // Never let a session from before sign-in survive it (fixation, switching accounts).
  await destroySession();
  await createSession(userId);
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

/** The user's saved locale, else the locale of the request that issued the code. */
function recipientLocale(saved: string | null, fallback: Locale): Locale {
  const value = saved ?? undefined;
  return isLocale(value) ? value : fallback;
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t, locale } = await getDictionary();
  const { ip } = await requestContext();
  const raw = fields(formData);
  const parsed = forgotSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: t.auth.errors.invalid };
  const guard = await guardCodeSend({ identifier: parsed.data.email, ip });
  if (!("ok" in guard)) return blockedState(guard, t, locale);
  if (!(await verifyCaptcha(captchaToken(raw), ip))) {
    return { status: "error", message: t.auth.states.captchaFailed };
  }

  const user = await db().query.users.findFirst({
    columns: { id: true, name: true, email: true, locale: true },
    where: eq(users.email, parsed.data.email),
  });
  // Same answer whether or not the email exists (no account enumeration).
  const sent: FormState = {
    status: "success",
    message: t.auth.forgot.sent,
    email: parsed.data.email,
  };
  if (!user?.email) {
    // Same hashing and DB work as the known-email path; only the send is skipped.
    await issueCodeDecoy("password_reset");
    return sent;
  }

  const { codeId, code } = await issueCode(user.id, "password_reset");

  try {
    await sendEvent("auth/code-email", {
      codeId,
      to: user.email,
      locale: recipientLocale(user.locale, locale),
      purpose: "password_reset",
      code,
      name: user.name,
    });
  } catch (error: unknown) {
    // Same answer as for an unknown email; the status endpoint reports a failed send later.
    console.error("Code email enqueue failed", error instanceof Error ? error.name : "unknown");
  }
  return sent;
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t, locale } = await getDictionary();
  await requestContext();
  const parsed = resetSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: t.auth.errors.invalid };
  const input = parsed.data;
  const guard = await guardCodeVerify({ identifier: input.email });
  if (!("ok" in guard)) return blockedState(guard, t, locale);

  const user = await db().query.users.findFirst({
    columns: { id: true, email: true },
    where: eq(users.email, input.email),
  });
  if (!user) {
    await verifyCodeDecoy("password_reset", input.code);
    return { status: "error", message: t.auth.errors.code };
  }

  const verified = await verifyCode(user.id, "password_reset", input.code);
  if (!verified.ok) return { status: "error", message: t.auth.errors.code };

  const passwordHash = await hashPassword(input.password);
  const now = clock.now();
  await db().transaction(async (tx) => {
    await tx
      .insert(credentials)
      .values({ userId: user.id, passwordHash, passwordSalt: null, updatedAt: now })
      .onConflictDoUpdate({
        target: credentials.userId,
        set: { passwordHash, passwordSalt: null, updatedAt: now },
      });
  });
  // A password reset signs the account out everywhere.
  await invalidateUserSessions(user.id);
  return { status: "success", message: t.auth.reset.done };
}
