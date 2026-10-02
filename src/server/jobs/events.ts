export type EmailSendData = { to: string; subject: string; text: string; html: string };

/** Event name -> payload type. Add new events here; `sendEvent` and the handlers follow. */
export type EventMap = {
  "email/send": EmailSendData;
  "system/ping": Record<string, never>;
};

export type EventName = keyof EventMap;
