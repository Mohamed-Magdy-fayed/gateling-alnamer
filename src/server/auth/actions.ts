"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import type { Dictionary } from "@/i18n/ar";
import { format, formatTime, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { clock } from "@/server/clock";
import { CODE_RESEND_COOLDOWN_MS } from "@/server/config/policy";
import { db } from "@/server/db";
import { credentials, users } from "@/server/db/schema";
import { gateDevice } from "@/server/devices/sign-in";
import {
  clearCodeVerifyFailures,
  clearSignInFailures,
  type GuardResult,
  guardCodeSend,
  guardCodeVerify,
  guardSignIn,
  guardSignUp,
} from "./abuse";
import { verifyCaptcha } from "./captcha";
import { latestCodeRow } from "./code-status";
import { type CodePurpose, verifyCode, verifyCodeDecoy } from "./codes";
import { authenticate } from "./credentials";
import { hashPassword } from "./password";
import { clearPendingReset, readPendingReset, setPendingReset } from "./pending-reset";
import { requestContext } from "./request-context";
import { sendCode } from "./send-code";
import { createSession, destroySession, getCurrentUser, invalidateUserSessions } from "./session";
import { type SignUpField, signUpUser } from "./sign-up";

/** How the form-level message looks and sounds: danger is an error, warning a wait or a delay. */
export type MessageTone = "info" | "success" | "warning" | "danger";

export type FormState = {
  status: "idle" | "error" | "success";
  /** Overrides the tone the status implies (error = danger, success = success). */
  tone?: MessageTone;
  message?: string;
  /** Per-field messages (already translated) for the sign-up form. */
  fieldErrors?: Partial<Record<SignUpField, string>>;
  /** Set when the form-level error should offer the forgot-password link. */
  offerReset?: boolean;
  /** Set when the form-level error should link to the email confirmation page. */
  offerVerify?: boolean;
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
      tone: "danger",
      message: format(t.auth.states.lockout, { time }),
      offerReset: true,
      retryAt,
    };
  }
  if (blocked.blocked === "rateLimited") {
    return { status: "error", tone: "warning", message: t.auth.states.rateLimited, retryAt };
  }
  return {
    status: "error",
    tone: "danger",
    message: t.auth.states.captchaFailed,
    captchaRequired: true,
  };
}

/**
 * A code-verify block. The pair lock reads as a rate limit with its end time (the sign-in lockout
 * copy talks about signing in); a captcha step-up is the usual one.
 */
function verifyBlockedState(blocked: Blocked, t: Dictionary, locale: Locale): FormState {
  if (blocked.blocked === "locked") {
    return {
      status: "error",
      tone: "warning",
      message: t.auth.states.rateLimited,
      retryAt: blocked.until?.getTime(),
    };
  }
  return blockedState(blocked, t, locale);
}

/**
 * Runs a code send once the response has gone out, so a registered and an unregistered email return
 * in the same time. A failure is logged by name only (never the code or the address).
 */
function sendAfterResponse(task: () => Promise<void>): void {
  after(async () => {
    try {
      await task();
    } catch (error: unknown) {
      console.error("Deferred code send failed", error instanceof Error ? error.name : "unknown");
    }
  });
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
const codeField = z.string().regex(/^\d{6}$/);
const resetSchema = z.object({
  /** Absent when the pending-reset cookie names the account. */
  email: z.preprocess((value) => (value === "" ? undefined : value), email.optional()),
  code: codeField,
  password,
});
const verifySchema = z.object({ code: codeField });
const resendSchema = z.object({ purpose: z.enum(["email_verify", "password_reset"]) });

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
  await sendVerificationCode(result.userId, locale);
  redirect("/verify-email");
}

/** Sign-up still succeeds when the code cannot be issued: /verify-email offers a resend. */
async function sendVerificationCode(userId: string, locale: Locale): Promise<void> {
  try {
    const created = await db().query.users.findFirst({
      columns: { id: true, name: true, email: true, locale: true },
      where: eq(users.id, userId),
    });
    if (created) await sendCode(created, "email_verify", locale);
  } catch (error: unknown) {
    console.error("Verification code failed", error instanceof Error ? error.name : "unknown");
  }
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
  const gate = await gateDevice(userId, {
    deviceKey: device.deviceKey,
    userAgent: device.userAgent,
    secure: device.secure,
  });
  // A student over the limit in strict mode gets a pre-session, never a session.
  if (gate.kind === "blocked") redirect("/devices/blocked");
  await createSession(userId, { deviceId: gate.deviceId });
  redirect(gate.overLimit ? "/dashboard?notice=device-over" : "/dashboard");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/");
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
  // The captcha comes first: a failed challenge must not spend the account's send budget, or anyone
  // could exhaust a victim's three codes without solving anything.
  if (!(await verifyCaptcha(captchaToken(raw), ip))) {
    return { status: "error", message: t.auth.states.captchaFailed };
  }
  const guard = await guardCodeSend({ identifier: parsed.data.email, ip });
  if (!("ok" in guard)) return blockedState(guard, t, locale);

  const user = await db().query.users.findFirst({
    columns: { id: true, name: true, email: true, locale: true },
    where: eq(users.email, parsed.data.email),
  });
  // Issuing the code and sending the mail happen after the response; both paths do the same
  // work before it (one lookup), so the answer's timing says nothing about the account.
  if (user?.email) sendAfterResponse(() => sendCode(user, "password_reset", locale));
  // Same answer whether or not the email exists (no account enumeration): the code screen, with
  // the email kept in a signed server-side cookie instead of the URL.
  await setPendingReset(parsed.data.email);
  redirect("/reset-password");
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t, locale } = await getDictionary();
  const { ip, deviceId } = await requestContext();
  const raw = fields(formData);
  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) {
    const badCode = parsed.error.issues.some((issue) => issue.path[0] === "code");
    return {
      status: "error",
      message: badCode ? t.auth.states.codeInvalid : t.auth.errors.invalid,
    };
  }
  const input = parsed.data;
  const target = input.email ?? (await readPendingReset())?.email;
  if (!target) return { status: "error", message: t.auth.states.codeInvalid };
  const who = { purpose: "password_reset", identifier: target, ip, deviceId } as const;
  const guard = await guardCodeVerify({ ...who, captchaToken: captchaToken(raw) });
  if (!("ok" in guard)) return verifyBlockedState(guard, t, locale);

  const user = await db().query.users.findFirst({
    columns: { id: true, email: true },
    where: eq(users.email, target),
  });
  if (!user) {
    await verifyCodeDecoy("password_reset", input.code);
    return { status: "error", message: t.auth.states.codeInvalid };
  }

  // Consuming the code and writing the credential commit together: a failed write leaves the code
  // usable, and a code can never be spent without the password changing.
  const reset = await db().transaction(async (tx) => {
    const verified = await verifyCode(user.id, "password_reset", input.code, tx);
    if (!verified.ok) return false;
    const passwordHash = await hashPassword(input.password);
    const now = clock.now();
    await tx
      .insert(credentials)
      .values({ userId: user.id, passwordHash, passwordSalt: null, updatedAt: now })
      .onConflictDoUpdate({
        target: credentials.userId,
        set: { passwordHash, passwordSalt: null, updatedAt: now },
      });
    return true;
  });
  if (!reset) return { status: "error", message: t.auth.states.codeInvalid };
  await clearCodeVerifyFailures(who);
  // A password reset signs the account out everywhere.
  await invalidateUserSessions(user.id);
  await clearPendingReset();
  return { status: "success", message: t.auth.reset.done };
}

/** Confirms the signed-in user's email with the code that was mailed to them. */
export async function verifyEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t, locale } = await getDictionary();
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const raw = fields(formData);
  const parsed = verifySchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: t.auth.states.codeInvalid };
  const { ip, deviceId } = await requestContext();
  const who = {
    purpose: "email_verify",
    identifier: user.email ?? user.id,
    ip,
    deviceId,
  } as const;
  const guard = await guardCodeVerify({ ...who, captchaToken: captchaToken(raw) });
  if (!("ok" in guard)) return verifyBlockedState(guard, t, locale);

  // The code is consumed and the email marked verified in one transaction.
  const confirmed = await db().transaction(async (tx) => {
    const verified = await verifyCode(user.id, "email_verify", parsed.data.code, tx);
    if (!verified.ok) return false;
    await tx.update(users).set({ emailVerifiedAt: clock.now() }).where(eq(users.id, user.id));
    return true;
  });
  if (!confirmed) return { status: "error", message: t.auth.states.codeInvalid };
  await clearCodeVerifyFailures(who);
  revalidatePath("/dashboard", "layout");
  // The verify page re-renders with the confirmed heading while the form keeps its success state.
  revalidatePath("/verify-email");
  return { status: "success", message: t.auth.states.verified };
}

/** What a resend needs: who the code is for and the earliest time a new one may go out. */
type ResendTarget = { email: string; id: string | null; nextAt: number };

async function resendTarget(purpose: CodePurpose): Promise<ResendTarget | "anonymous" | null> {
  if (purpose === "email_verify") {
    const user = await getCurrentUser();
    if (!user) return "anonymous";
    if (!user.email) return null;
    const row = await latestCodeRow(user.id, purpose);
    const nextAt = row ? row.createdAt.getTime() + CODE_RESEND_COOLDOWN_MS : 0;
    return { email: user.email, id: user.id, nextAt };
  }
  const pending = await readPendingReset();
  if (!pending) return null;
  return { email: pending.email, id: null, nextAt: pending.issuedAt + CODE_RESEND_COOLDOWN_MS };
}

/**
 * Sends a new code for the screen the user is on: email verification (signed in) or the reset in
 * progress (the pending cookie). Both pass the code-send limits and a one-minute cooldown, and a
 * reset answers the same for an unknown email.
 */
export async function resendCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t, locale } = await getDictionary();
  const parsed = resendSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: t.auth.states.codeInvalid };
  const { purpose } = parsed.data;
  const { ip } = await requestContext();

  const target = await resendTarget(purpose);
  if (target === "anonymous") redirect("/sign-in");
  if (!target) return { status: "error", message: t.auth.states.codeInvalid };
  if (target.nextAt > clock.now().getTime()) {
    return {
      status: "error",
      tone: "warning",
      message: t.auth.states.rateLimited,
      retryAt: target.nextAt,
    };
  }
  const guard = await guardCodeSend({ identifier: target.email, ip });
  if (!("ok" in guard)) return blockedState(guard, t, locale);

  const user = await db().query.users.findFirst({
    columns: { id: true, name: true, email: true, locale: true },
    where: target.id ? eq(users.id, target.id) : eq(users.email, target.email),
  });
  if (user && purpose === "password_reset") {
    sendAfterResponse(() => sendCode(user, purpose, locale));
  } else if (user) {
    await sendCode(user, purpose, locale);
  }
  if (purpose === "password_reset") await setPendingReset(target.email);
  return { status: "success", message: t.auth.states.codeSent };
}
