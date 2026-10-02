import "server-only";
import { serverEnv } from "@/server/env";
import { inngest } from "./client";
import type { EventMap, EventName } from "./events";
import { handlePing } from "./functions/ping";
import { handleSendEmail } from "./functions/send-email";

type Handlers = { [K in EventName]: (data: EventMap[K]) => Promise<void> };

const inlineHandlers: Handlers = {
  "email/send": handleSendEmail,
  "system/ping": handlePing,
};

/**
 * `inline` runs the handler in-process and awaits it (errors propagate to the caller);
 * `inngest-dev` / `inngest` enqueue through Inngest and return without running it.
 */
export async function sendEvent<K extends EventName>(name: K, data: EventMap[K]): Promise<void> {
  if (serverEnv().providers.jobs === "inline") {
    await inlineHandlers[name](data);
    return;
  }
  await inngest.send({ name, data: { encrypted: data } });
}
