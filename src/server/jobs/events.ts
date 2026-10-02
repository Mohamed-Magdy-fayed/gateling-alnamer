import type { Locale } from "@/i18n/config";

export type EmailSendData = { to: string; subject: string; text: string; html: string };

export type CodeEmailData = {
  codeId: string;
  to: string;
  locale: Locale;
  purpose: "email_verify" | "password_reset";
  code: string;
  name: string;
};

export type SupportRequestData = { userId: string; locale: Locale };

/** Event name -> payload type. Add new events here; `sendEvent` and the handlers follow. */
export type EventMap = {
  "email/send": EmailSendData;
  "auth/code-email": CodeEmailData;
  "devices/support-request": SupportRequestData;
  "system/ping": Record<string, never>;
};

export type EventName = keyof EventMap;

/**
 * Payloads travel under `data.encrypted`: the encryption middleware encrypts exactly that field, so
 * event data is ciphertext at rest in Inngest. Always wrap on send and unwrap in handlers.
 */
export type WireData<T> = { encrypted: T };
