import "server-only";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import type { Dictionary } from "@/i18n/ar";
import { format, formatTime, type Locale } from "@/i18n/config";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import type { GuardResult } from "./abuse";
import { sendCode } from "./send-code";

// The pieces the auth form actions share (sign-in, sign-up, codes, teacher application): the form
// state, guard-block messages, deferred sends and form-data helpers.

/** How the form-level message looks and sounds: danger is an error, warning a wait or a delay. */
export type MessageTone = "info" | "success" | "warning" | "danger";

export type FormState = {
  status: "idle" | "error" | "success";
  /** Overrides the tone the status implies (error = danger, success = success). */
  tone?: MessageTone;
  message?: string;
  /** Per-field messages (already translated), by field name. */
  fieldErrors?: Partial<Record<string, string>>;
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

export type Blocked = Exclude<GuardResult, { ok: true }>;

/**
 * The one message for a guard block. A captcha step-up shows the captchaFailed copy and tells the
 * form to render the widget; everything here depends only on counters, never on whether an account
 * exists.
 */
export function blockedState(blocked: Blocked, t: Dictionary, locale: Locale): FormState {
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
export function verifyBlockedState(blocked: Blocked, t: Dictionary, locale: Locale): FormState {
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
export function sendAfterResponse(task: () => Promise<void>): void {
  after(async () => {
    try {
      await task();
    } catch (error: unknown) {
      console.error("Deferred code send failed", error instanceof Error ? error.name : "unknown");
    }
  });
}

export function captchaToken(raw: Record<string, unknown>): string | undefined {
  return typeof raw.captcha_token === "string" ? raw.captcha_token : undefined;
}

export function fields(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

const ECHOED_FIELDS = [
  "name",
  "email",
  "username",
  "role",
  "date_of_birth",
  "guardian_consent",
  "note",
];

export function echo(raw: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ECHOED_FIELDS) {
    const value = raw[key];
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/** Sign-up still succeeds when the code cannot be issued: /verify-email offers a resend. */
export async function sendVerificationCode(userId: string, locale: Locale): Promise<void> {
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
