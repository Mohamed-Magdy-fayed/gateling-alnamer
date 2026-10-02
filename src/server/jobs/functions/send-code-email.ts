import { markCodeEmailFailed, markCodeEmailSent } from "@/server/auth/codes";
import { renderCodeEmail } from "@/server/auth/email-templates";
import { sendMail } from "@/server/email";
import { inngest } from "../client";
import type { CodeEmailData, WireData } from "../events";

const MAX_RETRIES = 3;

/** The part of Inngest's `step` this function uses; tests pass a memoizing stand-in. */
export type StepRunner = {
  run(id: string, fn: () => Promise<void>): Promise<unknown>;
};

/** Renders and sends the mail. Throws on a send error so Inngest can retry. */
async function sendCodeMail(data: CodeEmailData): Promise<void> {
  const mail = renderCodeEmail(data.locale, {
    name: data.name,
    code: data.code,
    purpose: data.purpose,
  });
  await sendMail({ to: data.to, ...mail });
}

/**
 * Two steps, so a failure of the bookkeeping after a successful send retries only the bookkeeping:
 * Inngest replays the memoized `send` result and never mails the code twice.
 */
export async function runCodeEmailSteps(data: CodeEmailData, step: StepRunner): Promise<void> {
  await step.run("send", () => sendCodeMail(data));
  await step.run("mark-sent", () => markCodeEmailSent(data.codeId));
}

export async function markCodeEmailFailedFromEvent(data: WireData<CodeEmailData>): Promise<void> {
  await markCodeEmailFailed(data.encrypted.codeId);
}

/**
 * The `inline` jobs provider: no retries, and a failed send must not change the caller's answer, so
 * a send failure is recorded as `failed` and swallowed. A failed bookkeeping write after a send that
 * went out is only logged (the mail was delivered). Nothing logged contains the code or address.
 */
export async function runCodeEmailInline(data: CodeEmailData): Promise<void> {
  try {
    await sendCodeMail(data);
  } catch (error: unknown) {
    console.error("Code email failed", error instanceof Error ? error.name : "unknown");
    await markCodeEmailFailed(data.codeId);
    return;
  }
  try {
    await markCodeEmailSent(data.codeId);
  } catch (error: unknown) {
    console.error("Code email mark failed", error instanceof Error ? error.name : "unknown");
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
  async ({ event, step }) => {
    await runCodeEmailSteps((event.data as WireData<CodeEmailData>).encrypted, step);
  },
);
