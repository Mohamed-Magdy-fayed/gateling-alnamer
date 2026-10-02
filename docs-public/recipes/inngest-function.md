# Recipe: add a background job (Inngest function)

Example in this codebase: `email/send` (`src/server/jobs/functions/send-email.ts`).

## Files to touch
- `src/server/jobs/events.ts`: add the event name and payload type to `EventMap`.
- `src/server/jobs/functions/<name>.ts`: the handler and the Inngest function.
- `src/server/jobs/functions/index.ts`: export the function so Inngest serves it.
- `src/server/jobs/send.ts`: add the handler to `inlineHandlers` (the compiler requires it).
- `src/server/jobs/send.test.ts`: the test.

## Test first
Mock the Inngest client and the side effect, then assert both modes (copy `send.test.ts`):

```ts
await sendEvent("email/send", mail);
expect(sendMailMock).toHaveBeenCalledWith(mail); // inline: runs in-process
// jobs = "inngest-dev": expect(sendMock).toHaveBeenCalledWith({ name: "email/send", data: mail })
```

## The code

```ts
// events.ts
export type EventMap = {
  "email/send": EmailSendData;
};
```

```ts
// functions/send-email.ts
export async function handleSendEmail(data: EmailSendData): Promise<void> {
  await sendMail(data);
}

export const sendEmail = inngest.createFunction(
  { id: "send-email", triggers: [{ event: "email/send" }] },
  async ({ event }) => {
    await handleSendEmail(event.data as EmailSendData);
  },
);
```

```ts
// send.ts
const inlineHandlers: Handlers = { "email/send": handleSendEmail };
```

Call it from server code with `await sendEvent("email/send", data)`.

## Rules
- Keep the handler a plain exported function so inline mode and Inngest run the same code.
- Handlers must be idempotent: Inngest retries on failure.
- `inline` mode awaits the handler and propagates errors; queued modes return immediately.
