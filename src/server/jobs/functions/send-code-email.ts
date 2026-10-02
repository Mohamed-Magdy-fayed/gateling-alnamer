import { markCodeEmailFailed, markCodeEmailSent } from "@/server/auth/codes";
import { renderCodeEmail } from "@/server/auth/email-templates";
import { sendMail } from "@/server/email";
import { inngest } from "../client";
import type { CodeEmailData, WireData } from "../events";

const MAX_RETRIES = 3;

/** Sends the mail and records `sent`. Throws on a send error so Inngest can retry. */
export async function handleSendCodeEmail(data: CodeEmailData): Promise<void> {
  const mail = renderCodeEmail(data.locale, {
    name: data.name,
    code: data.code,
    purpose: data.purpose,
  });
  await sendMail({ to: data.to, ...mail });
  await markCodeEmailSent(data.codeId);
}

export async function markCodeEmailFailedFromEvent(data: WireData<CodeEmailData>): Promise<void> {
  await markCodeEmailFailed(data.encrypted.codeId);
}

/**
 * The `inline` jobs provider: no retries, and a failed send must not change the caller's answer, so
 * the failure is recorded as `failed` and swallowed. Nothing logged contains the code or address.
 */
export async function runCodeEmailInline(data: CodeEmailData): Promise<void> {
  try {
    await handleSendCodeEmail(data);
  } catch (error: unknown) {
    console.error("Code email failed", error instanceof Error ? error.name : "unknown");
    await markCodeEmailFailed(data.codeId);
  }
}

export const sendCodeEmail = inngest.createFunction(
  {
    id: "send-code-email",
    retries: MAX_RETRIES,
    triggers: [{ event: "auth/code-email" }],
    onFailure: async ({ event }) => {
      await markCodeEmailFailedFromEvent(event.data.event.data as WireData<CodeEmailData>);
    },
  },
  async ({ event }) => {
    await handleSendCodeEmail((event.data as WireData<CodeEmailData>).encrypted);
  },
);
