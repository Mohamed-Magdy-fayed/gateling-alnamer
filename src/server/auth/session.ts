import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clock } from "@/server/clock";
import {
  SESSION_LAST_SEEN_INTERVAL_MS,
  SESSION_SLIDE_THRESHOLD_MS,
  SESSION_TTL_MS,
} from "@/server/config/policy";
import type { User } from "@/server/db/schema";
import { capDeviceSessions, touchDevice } from "@/server/devices/service";
import { randomToken, sha256 } from "./password";
import { cacheDelete, cacheGet, cacheSet } from "./session-cache";
import {
  clearedCookieOptions,
  LEGACY_SESSION_COOKIE,
  readSessionToken,
  SESSION_COOKIE,
  SESSION_REFRESHED_COOKIE,
  sessionCookieOptions,
} from "./session-cookie";
import { invalidateUserSessionsCore } from "./session-invalidate";
import {
  deleteSession,
  findSession,
  insertSession,
  type SessionRecord,
  setSessionDevice,
  updateSession,
} from "./session-repo";

export type SessionUser = Pick<User, "id" | "name" | "email" | "role" | "status">;

export type CurrentSession = {
  tokenHash: string;
  user: SessionUser;
  deviceId: string | null;
  twoFactorVerified: boolean;
};

type CreateOptions = { deviceId?: string | null; twoFactorVerified?: boolean };

/**
 * Cookie writes live only in `createSession`, `rotateSession` and `destroySession`, which run in
 * server actions and route handlers (Next refuses `cookies().set` during a render). Deleting a
 * leftover legacy cookie and the daily cookie re-issue that sliding expiry needs happen in `src/proxy.ts`.
 */
async function writeSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  const options = sessionCookieOptions(expiresAt);
  store.set(SESSION_COOKIE, token, options);
  store.set(SESSION_REFRESHED_COOKIE, String(clock.now().getTime()), options);
  if (store.get(LEGACY_SESSION_COOKIE)) {
    store.set(LEGACY_SESSION_COOKIE, "", clearedCookieOptions());
  }
}

async function insertFor(
  userId: string,
  { deviceId = null, twoFactorVerified = false }: CreateOptions,
): Promise<{ token: string; tokenHash: string; expiresAt: Date }> {
  const token = randomToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(clock.now().getTime() + SESSION_TTL_MS);
  await insertSession({ tokenHash, userId, expiresAt, deviceId, twoFactorVerified });
  await writeSessionCookie(token, expiresAt);
  return { token, tokenHash, expiresAt };
}

/** Creates a session; a device keeps at most MAX_SESSIONS_PER_DEVICE (D34), the oldest are revoked. */
export async function createSession(userId: string, options: CreateOptions = {}): Promise<void> {
  await insertFor(userId, options);
  if (options.deviceId) await capDeviceSessions(userId, options.deviceId);
}

/** Swaps the current session for a fresh token (same user, device and 2FA state). Call on privilege change. */
export async function rotateSession(): Promise<void> {
  const store = await cookies();
  const token = readSessionToken(store);
  const current = token ? await findSession(sha256(token), clock.now()) : null;
  if (!token || !current) throw new Error("rotateSession called without an active session");
  await insertFor(current.userId, {
    deviceId: current.deviceId,
    twoFactorVerified: current.twoFactorVerified,
  });
  await deleteSession(sha256(token));
  await cacheDelete(sha256(token));
}

/** Binds the current session to a device (the legacy-session check) and drops its cached copy. */
export async function attachDeviceToSession(deviceId: string): Promise<void> {
  const token = readSessionToken(await cookies());
  if (!token) return;
  const tokenHash = sha256(token);
  await setSessionDevice(tokenHash, deviceId);
  await cacheDelete(tokenHash);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = readSessionToken(store);
  if (token) {
    await deleteSession(sha256(token));
    await cacheDelete(sha256(token));
  }
  for (const name of [SESSION_COOKIE, SESSION_REFRESHED_COOKIE, LEGACY_SESSION_COOKIE]) {
    if (name === SESSION_COOKIE || store.get(name)) store.set(name, "", clearedCookieOptions());
  }
}

/**
 * The one revocation path (sign out everywhere, password reset, suspension, device revoke): deletes the
 * user's session rows and cache keys, optionally sparing one session. Reads cannot resurrect a deleted
 * row, so a cached session is denied on the very next request.
 */
export async function invalidateUserSessions(
  userId: string,
  options: { exceptTokenHash?: string } = {},
): Promise<void> {
  await invalidateUserSessionsCore(userId, options);
}

function housekeepingPatch(
  record: SessionRecord,
  now: Date,
): { expiresAt?: Date; lastSeenAt?: Date } {
  const patch: { expiresAt?: Date; lastSeenAt?: Date } = {};
  if (record.expiresAt.getTime() - now.getTime() < SESSION_SLIDE_THRESHOLD_MS) {
    patch.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  }
  if (
    !record.lastSeenAt ||
    now.getTime() - record.lastSeenAt.getTime() >= SESSION_LAST_SEEN_INTERVAL_MS
  ) {
    patch.lastSeenAt = now;
  }
  return patch;
}

async function resolveRecord(tokenHash: string, now: Date): Promise<SessionRecord | null> {
  const cached = await cacheGet(tokenHash);
  // The DB is the authority: an expired cache entry is treated as a miss.
  const record = cached && cached.expiresAt > now ? cached : await findSession(tokenHash, now);
  if (!record) return null;
  const fromCache = record === cached;

  const patch = record.status === "active" ? housekeepingPatch(record, now) : {};
  let next = record;
  if (patch.expiresAt || patch.lastSeenAt) {
    try {
      // 0 rows: the session was revoked after we read it, so it must not be served or re-cached.
      if ((await updateSession(tokenHash, patch)) === 0) {
        if (fromCache) await cacheDelete(tokenHash);
        return null;
      }
      next = { ...record, ...patch };
      // The device's own throttle (5 minutes) keeps this from writing more than the session does.
      if (patch.lastSeenAt && record.deviceId) await touchDevice(record.deviceId);
    } catch (error) {
      console.error("Session housekeeping failed", error instanceof Error ? error.message : error);
    }
  }
  if (!fromCache || next !== record) await cacheSet(tokenHash, next);
  return next;
}

/** The current session for this request, or null. Cached per request; suspended users are rejected. */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const now = clock.now();
  const token = readSessionToken(await cookies());
  if (!token) return null;
  const tokenHash = sha256(token);
  const record = await resolveRecord(tokenHash, now);
  if (record?.status !== "active") return null;
  return {
    tokenHash,
    deviceId: record.deviceId,
    twoFactorVerified: record.twoFactorVerified,
    user: {
      id: record.userId,
      name: record.name,
      email: record.email,
      role: record.role,
      status: record.status,
    },
  };
});

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  return (await getCurrentSession())?.user ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
