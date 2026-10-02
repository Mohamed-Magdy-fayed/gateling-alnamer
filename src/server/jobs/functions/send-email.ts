import { sendMail } from "@/server/email";
import { inngest } from "../client";
import type { EmailSendData, WireData } from "../events";

export async function handleSendEmail(data: EmailSendData): Promise<void> {
  await sendMail(data);
}

export const sendEmail = inngest.createFunction(
  { id: "send-email", triggers: [{ event: "email/send" }] },
  async ({ event }) => {
    await handleSendEmail((event.data as WireData<EmailSendData>).encrypted);
  },
);
