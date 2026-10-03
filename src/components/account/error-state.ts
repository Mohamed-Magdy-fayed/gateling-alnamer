import { isTRPCClientError } from "@trpc/client";
import type { AuthText } from "@/components/auth-parts";
import type { AppRouter } from "@/server/api/root";
import type { FormState } from "@/server/auth/actions";

/**
 * Turns a failed `account.*` call into the section message. The server sends dictionary keys;
 * a limit reads as a warning, a wrong code as the code message, anything else as "check the details".
 */
export function accountErrorState(
  error: unknown,
  t: AuthText,
  /** The field a rejected input points at; a validation failure is shown on it with `aria-invalid`. */
  field?: "name" | "email" | "password",
): FormState {
  if (!isTRPCClientError<AppRouter>(error)) {
    return { status: "error", message: t.errors.invalid };
  }
  if (error.data?.code === "TOO_MANY_REQUESTS") {
    return { status: "error", tone: "warning", message: t.states.rateLimited };
  }
  if (field && error.data?.code === "BAD_REQUEST") {
    return {
      status: "error",
      message: t.errors.invalid,
      fieldErrors: { [field]: t.errors.field[field] },
    };
  }
  if (error.message === "auth.states.codeInvalid") {
    return { status: "error", message: t.states.codeInvalid };
  }
  return { status: "error", message: t.errors.invalid };
}
