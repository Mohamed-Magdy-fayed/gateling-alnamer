import "server-only";
import { eq } from "drizzle-orm";
import { SEEN_DID_TTL_SEC } from "@/server/config/policy";
import { db } from "@/server/db";
import { devices } from "@/server/db/schema";
import { getRedis } from "@/server/redis";
import { authKey, keyedHash } from "./keys";

/**
 * D36: the sign-in pair lock keys on the device id only for a device the server has seen, so a
 * client cannot reset its lock by presenting a fresh, validly signed `did` (every request mints
 * one). "Seen" means the id is in `devices` (any user, revoked or not) or in a Redis marker written
 * after a successful sign-in (30 days). The marker key is an HMAC under the `rl` sub-key, never the raw id.
 */
type SeenStore = {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { ex: number }): Promise<unknown>;
};

export type KnownDeviceDeps = {
  /** `undefined` uses the shared client; `null` means no Redis (demo). */
  readonly redis?: SeenStore | null;
  readonly key?: Buffer;
  readonly deviceExists?: (deviceId: string) => Promise<boolean>;
};

const seenKey = (deviceId: string, deps: KnownDeviceDeps): string =>
  `seendid:${keyedHash(deps.key ?? authKey("rl"), deviceId)}`;

const storeOf = (deps: KnownDeviceDeps): SeenStore | null =>
  deps.redis === undefined ? getRedis() : deps.redis;

async function inDevicesTable(deviceId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.deviceKey, deviceId))
    .limit(1);
  return row !== undefined;
}

/** True when the id is a device this server knows; any failure reads as "unknown" (the IP pair stands in). */
export async function isKnownDevice(
  deviceId: string,
  deps: KnownDeviceDeps = {},
): Promise<boolean> {
  const store = storeOf(deps);
  if (store) {
    try {
      if ((await store.get(seenKey(deviceId, deps))) !== null) return true;
    } catch (error: unknown) {
      console.error("Seen-device read failed", error instanceof Error ? error.name : "unknown");
    }
  }
  try {
    return await (deps.deviceExists ?? inDevicesTable)(deviceId);
  } catch (error: unknown) {
    console.error("Device lookup failed", error instanceof Error ? error.name : "unknown");
    return false;
  }
}

/** Records a device id after a successful sign-in; never throws (the sign-in already happened). */
export async function markDeviceSeen(deviceId: string, deps: KnownDeviceDeps = {}): Promise<void> {
  const store = storeOf(deps);
  if (!store) return;
  try {
    await store.set(seenKey(deviceId, deps), "1", { ex: SEEN_DID_TTL_SEC });
  } catch (error: unknown) {
    console.error("Seen-device write failed", error instanceof Error ? error.name : "unknown");
  }
}
