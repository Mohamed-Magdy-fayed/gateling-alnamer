import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DEVICE_COOKIE_MAX_AGE_SEC } from "@/server/config/policy";

/** Not `__Host-`: the cookie must also work over plain http on localhost and in tests. */
export const DEVICE_COOKIE = "did";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mac = (id: string, key: Buffer | string): string =>
  createHmac("sha256", key).update(id).digest("base64url");

/** `<uuid>.<base64url HMAC-SHA256(uuid, key)>`; `key` is the `did` sub-key of AUTH_SECRET. */
export function signDeviceId(id: string, key: Buffer | string): string {
  return `${id}.${mac(id, key)}`;
}

/** The device id when the cookie is correctly signed, otherwise null (tampered, unsigned or foreign). */
export function parseDeviceCookie(value: string | undefined, key: Buffer | string): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  if (!UUID.test(id)) return null;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(id, key));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

export type DeviceCookieStore = {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number },
  ): void;
};

/**
 * Keeps a validly signed device id (refreshing its lifetime) or issues a new one. Call it only from
 * auth server actions: never from the proxy or a public page. `existing` is false when the id was
 * just minted, so the caller does not trust it as a returning device.
 */
export function issueDeviceCookie(
  store: DeviceCookieStore,
  { key, secure }: { key: Buffer | string; secure: boolean },
): { id: string; existing: boolean } {
  const current = parseDeviceCookie(store.get(DEVICE_COOKIE)?.value, key);
  const id = current ?? randomUUID();
  store.set(DEVICE_COOKIE, signDeviceId(id, key), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_SEC,
  });
  return { id, existing: current !== null };
}
