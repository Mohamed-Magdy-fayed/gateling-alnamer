import { purgeCodesOlderThan } from "@/server/auth/codes";
import { clock } from "@/server/clock";
import { CODE_PURGE_AFTER_MS } from "@/server/config/policy";
import { inngest } from "../client";

export const PURGE_AFTER_MS = CODE_PURGE_AFTER_MS;
/** Daily at 03:00 UTC. */
export const PURGE_CRON = "0 3 * * *";

/** Deletes verification codes consumed or expired more than 24 hours ago; returns how many went. */
export async function handlePurgeCodes(): Promise<number> {
  return purgeCodesOlderThan(new Date(clock.now().getTime() - PURGE_AFTER_MS));
}

export const purgeCodes = inngest.createFunction(
  { id: "auth/purge-codes", triggers: [{ cron: PURGE_CRON }] },
  async ({ step }) => {
    const removed = await step.run("purge", handlePurgeCodes);
    return { removed };
  },
);
