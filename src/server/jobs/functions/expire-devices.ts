import { expireDevices } from "@/server/devices/service";
import { inngest } from "../client";

/** Daily at 03:00 Cairo time (Inngest cron TZ syntax). */
export const EXPIRE_DEVICES_CRON = "TZ=Africa/Cairo 0 3 * * *";

/** Revokes devices idle for 30 days and ends their sessions; returns how many expired. Safe to retry. */
export async function handleExpireDevices(): Promise<number> {
  return (await expireDevices()).length;
}

export const expireDevicesJob = inngest.createFunction(
  { id: "devices/expire", triggers: [{ cron: EXPIRE_DEVICES_CRON }] },
  async ({ step }) => {
    const expired = await step.run("expire", handleExpireDevices);
    return { expired };
  },
);
