import { isLocale, type Locale } from "@/i18n/config";
import { supportContacts, supportStudent } from "@/server/devices/service";
import { renderSupportEmail } from "@/server/devices/support-email";
import { sendMail } from "@/server/email";
import { inngest } from "../client";
import type { SupportRequestData, WireData } from "../events";

const MAX_RETRIES = 3;

function contactLocale(saved: string | null, fallback: Locale): Locale {
  const value = saved ?? undefined;
  return isLocale(value) ? value : fallback;
}

async function sendTo(
  contact: { email: string; locale: string | null },
  student: { name: string; publicNumber: string | null },
  fallback: Locale,
): Promise<void> {
  const mail = renderSupportEmail(contactLocale(contact.locale, fallback), student);
  await sendMail({ to: contact.email, ...mail });
}

/** Mails every support contact about a blocked student, each in their own locale. */
export async function handleSupportRequest(data: SupportRequestData): Promise<void> {
  const [student, contacts] = await Promise.all([
    supportStudent(data.userId),
    supportContacts(data.userId),
  ]);
  if (!student) return;
  for (const contact of contacts) await sendTo(contact, student, data.locale);
}

export const supportRequest = inngest.createFunction(
  {
    id: "devices/support-request",
    retries: MAX_RETRIES,
    triggers: [{ event: "devices/support-request" }],
  },
  async ({ event, step }) => {
    const data = (event.data as WireData<SupportRequestData>).encrypted;
    const [student, contacts] = await step
      .run("load", async () => ({
        student: await supportStudent(data.userId),
        contacts: await supportContacts(data.userId),
      }))
      .then((r) => [r.student, r.contacts] as const);
    if (!student) return;
    // One step per recipient: a retry never re-mails an address that already got it.
    for (const [index, contact] of contacts.entries()) {
      await step.run(`send-${index}`, () => sendTo(contact, student, data.locale));
    }
  },
);
