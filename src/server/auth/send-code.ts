import "server-only";
import { isLocale, type Locale } from "@/i18n/config";
import { sendEvent } from "@/server/jobs/send";
import { type CodePurpose, issueCode } from "./codes";

export type CodeRecipient = {
  id: string;
  name: string;
  email: string | null;
  locale: string | null;
};

/** The user's saved locale, else the locale of the request that issued the code. */
function recipientLocale(saved: string | null, fallback: Locale): Locale {
  const value = saved ?? undefined;
  return isLocale(value) ? value : fallback;
}

/**
 * Issues a fresh code and queues its email. With `pendingEmail` the code is for that not-yet-verified
 * address (it is stored on the code row, never on the user) and the mail goes there. With
 * `requesterHash` a reset code belongs to the browser that asked for it. An enqueue failure is logged (name only, never the
 * code or the address) and not thrown: the answer to the user stays the same, and the status
 * endpoint reports a send that never went out.
 */
export async function sendCode(
  user: CodeRecipient,
  purpose: CodePurpose,
  requestLocale: Locale,
  options: { pendingEmail?: string; requesterHash?: string } = {},
): Promise<void> {
  const { pendingEmail, requesterHash } = options;
  const to = pendingEmail ?? user.email;
  if (!to) return;
  const { codeId, code } = await issueCode(
    user.id,
    purpose,
    undefined,
    pendingEmail,
    requesterHash,
  );
  try {
    await sendEvent("auth/code-email", {
      codeId,
      to,
      locale: recipientLocale(user.locale, requestLocale),
      purpose,
      code,
      name: user.name,
    });
  } catch (error: unknown) {
    console.error("Code email enqueue failed", error instanceof Error ? error.name : "unknown");
  }
}
