import { inngest } from "../client";

export async function handlePing(): Promise<void> {}

export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "system/ping" }] },
  async () => {
    await handlePing();
  },
);
