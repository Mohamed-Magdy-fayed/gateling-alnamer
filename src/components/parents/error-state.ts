import { isTRPCClientError } from "@trpc/client";
import type { AuthText } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import type { AppRouter } from "@/server/api/root";
import type { FormState } from "@/server/auth/actions";
import type { SignUpField } from "@/server/auth/sign-up";

/** The two dictionary groups every parent and link form reads. */
export type ParentTexts = { parents: Dictionary["parents"]; auth: AuthText };

const FIELD_PREFIX = "auth.errors.field.";
const FORM_FIELDS: readonly SignUpField[] = [
  "name",
  "email",
  "username",
  "password",
  "date_of_birth",
];
const AGE_REASONS = ["parentAge", "studentMinAge"];

function fieldState(reason: string, t: ParentTexts): FormState {
  const field = (AGE_REASONS.includes(reason) ? "date_of_birth" : reason) as SignUpField;
  const known = Object.hasOwn(t.auth.errors.field, reason);
  if (!known || !FORM_FIELDS.includes(field)) {
    return { status: "error", message: t.auth.errors.invalid };
  }
  const text = t.auth.errors.field[reason as keyof typeof t.auth.errors.field];
  return { status: "error", message: t.auth.errors.invalid, fieldErrors: { [field]: text } };
}

/**
 * Turns a failed `parent.*` or `student.parentLinks.*` call into the form message. The server sends
 * dictionary keys; anything unknown reads as the generic "check the details" message.
 */
export function errorState(error: unknown, t: ParentTexts): FormState {
  if (!isTRPCClientError<AppRouter>(error)) {
    return { status: "error", message: t.auth.errors.invalid };
  }
  if (error.data?.code === "TOO_MANY_REQUESTS") {
    return { status: "error", tone: "warning", message: t.auth.states.rateLimited };
  }
  const key = error.message;
  if (key.startsWith(FIELD_PREFIX)) return fieldState(key.slice(FIELD_PREFIX.length), t);
  switch (key) {
    case "parents.limitChildren":
      return { status: "error", message: t.parents.limitChildren };
    case "parents.limitInvites":
      return { status: "error", message: t.parents.limitInvites };
    case "parents.verifyFirst":
      return {
        status: "error",
        tone: "warning",
        message: t.parents.verifyFirst,
        offerVerify: true,
      };
    case "parents.limitParents":
      return { status: "error", message: t.parents.limitParents };
    case "parents.linkInvalid":
      return { status: "error", message: t.parents.linkInvalid };
    case "auth.errors.checkDetails":
      return { status: "error", message: t.auth.errors.checkDetails };
    default:
      return { status: "error", message: t.auth.errors.invalid };
  }
}
