import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { writeAudit } from "@/server/audit/repository";
import { cacheDeleteUser } from "@/server/auth/session-cache";
import { clock } from "@/server/clock";
import { SESSION_LAST_SEEN_INTERVAL_MS } from "@/server/config/policy";
import { db } from "@/server/db";
import { deviceRemovals, devices, sessions, type UserRole, users } from "@/server/db/schema";
import { readPlatformSettings } from "@/server/settings/repository";
import { deviceLabel } from "./label";
import { decide, nextSelfRemovalAt as policyNextSelfRemovalAt } from "./policy";

export const DEVICE_EXPIRY_DAYS = 30;
const DEVICE_EXPIRY_MS = DEVICE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export type RegisterOutcome = "known" | "register" | "registerOver" | "block";
export type RegisterResult = {
  outcome: RegisterOutcome;
  /** The device row for known/register/registerOver; null when blocked. */
  deviceId: string | null;
  /** Active devices before this call. */
  count: number;
};

async function lockUserDevices(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`devices:${userId}`}))`);
}

/** Deletes the sessions bound to `deviceIds` inside `tx`; returns their user and token hashes for cache cleanup. */
async function deleteDeviceSessions(tx: Tx, deviceIds: string[]) {
  if (deviceIds.length === 0) return [];
  return tx
    .delete(sessions)
    .where(inArray(sessions.deviceId, deviceIds))
    .returning({ userId: sessions.userId, tokenHash: sessions.tokenHash });
}

async function purgeSessionCache(deleted: { userId: string; tokenHash: string }[]): Promise<void> {
  const byUser = new Map<string, string[]>();
  for (const { userId, tokenHash } of deleted) {
    byUser.set(userId, [...(byUser.get(userId) ?? []), tokenHash]);
  }
  for (const [userId, hashes] of byUser) await cacheDeleteUser(userId, hashes);
}

/**
 * Decides whether this browser may sign in, and registers it when allowed. One transaction per
 * user under an advisory lock, so two tabs cannot both take the last slot.
 */
export async function registerOrBlock(
  userId: string,
  deviceKey: string,
  userAgent: string | null,
): Promise<RegisterResult> {
  return db().transaction(async (tx) => {
    await lockUserDevices(tx, userId);
    const [settings, active] = await Promise.all([
      readPlatformSettings(tx),
      tx
        .select({ id: devices.id, deviceKey: devices.deviceKey })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt))),
    ]);
    const count = active.length;
    const outcome = decide({
      activeDevices: active,
      deviceKey,
      limit: settings.deviceLimit,
      mode: settings.deviceLimitMode,
    });

    if (outcome === "known") {
      return {
        outcome,
        deviceId: active.find((d) => d.deviceKey === deviceKey)?.id ?? null,
        count,
      };
    }
    if (outcome === "block") {
      await writeAudit(tx, {
        actorId: userId,
        action: "device.limit_exceeded",
        subjectType: "user",
        subjectId: userId,
        after: { mode: "strict", count },
      });
      return { outcome, deviceId: null, count };
    }

    const [created] = await tx
      .insert(devices)
      .values({
        userId,
        deviceKey,
        label: deviceLabel(userAgent),
        firstSeenAt: clock.now(),
        lastSeenAt: clock.now(),
      })
      .returning({ id: devices.id });
    if (!created) throw new Error("device insert returned no row");
    if (outcome === "registerOver") {
      await writeAudit(tx, {
        actorId: userId,
        action: "device.limit_exceeded",
        subjectType: "user",
        subjectId: userId,
        after: { mode: "soft", count },
      });
    }
    return { outcome, deviceId: created.id, count };
  });
}

/** Updates the device (and optionally its session) last_seen_at when older than 5 minutes. Returns whether it wrote. */
export async function touchDevice(deviceId: string, sessionTokenHash?: string): Promise<boolean> {
  const now = clock.now();
  const cutoff = new Date(now.getTime() - SESSION_LAST_SEEN_INTERVAL_MS);
  return db().transaction(async (tx) => {
    const rows = await tx
      .update(devices)
      .set({ lastSeenAt: now })
      .where(
        and(eq(devices.id, deviceId), isNull(devices.revokedAt), lt(devices.lastSeenAt, cutoff)),
      )
      .returning({ id: devices.id });
    if (rows.length === 0) return false;
    if (sessionTokenHash) {
      await tx
        .update(sessions)
        .set({ lastSeenAt: now })
        .where(eq(sessions.tokenHash, sessionTokenHash));
    }
    return true;
  });
}

export type ActiveDeviceCheck =
  | { ok: true }
  | { ok: false; reason: "needs_check" | "device_inactive" };

/** The paid-content backstop: non-students pass; a student needs a session device that is not revoked. */
export async function assertActiveDevice(session: {
  role: UserRole;
  deviceId: string | null;
}): Promise<ActiveDeviceCheck> {
  if (session.role !== "student") return { ok: true };
  if (!session.deviceId) return { ok: false, reason: "needs_check" };
  const [row] = await db()
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, session.deviceId), isNull(devices.revokedAt)))
    .limit(1);
  return row ? { ok: true } : { ok: false, reason: "device_inactive" };
}

/** When the student's next self removal opens, or null when one is allowed now. */
export async function nextSelfRemovalAt(userId: string): Promise<Date | null> {
  const rows = await db()
    .select({ kind: deviceRemovals.kind, createdAt: deviceRemovals.createdAt })
    .from(deviceRemovals)
    .where(and(eq(deviceRemovals.userId, userId), eq(deviceRemovals.kind, "self")))
    .orderBy(desc(deviceRemovals.createdAt))
    .limit(1);
  return policyNextSelfRemovalAt(rows, clock.now());
}

export type RemoveDeviceResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "is_current" }
  | { ok: false; reason: "throttled"; nextAt: Date };

/** Self removal: revokes one of the student's own devices, signs it out, and starts the 7-day throttle. */
export async function removeDevice(input: {
  userId: string;
  deviceId: string;
  /** The cookie key of the device making the request; it cannot remove itself. */
  currentDeviceKey: string;
}): Promise<RemoveDeviceResult> {
  const { userId, deviceId, currentDeviceKey } = input;
  const result = await db().transaction(async (tx) => {
    await lockUserDevices(tx, userId);
    const [device] = await tx
      .select({ id: devices.id, deviceKey: devices.deviceKey })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
      .limit(1);
    if (!device) return { ok: false, reason: "not_found" } as const;
    if (device.deviceKey === currentDeviceKey) return { ok: false, reason: "is_current" } as const;

    const [lastSelf] = await tx
      .select({ kind: deviceRemovals.kind, createdAt: deviceRemovals.createdAt })
      .from(deviceRemovals)
      .where(and(eq(deviceRemovals.userId, userId), eq(deviceRemovals.kind, "self")))
      .orderBy(desc(deviceRemovals.createdAt))
      .limit(1);
    const nextAt = policyNextSelfRemovalAt(lastSelf ? [lastSelf] : [], clock.now());
    if (nextAt) return { ok: false, reason: "throttled", nextAt } as const;

    const now = clock.now();
    await tx
      .update(devices)
      .set({ revokedAt: now, revokedReason: "self" })
      .where(eq(devices.id, deviceId));
    const deleted = await deleteDeviceSessions(tx, [deviceId]);
    await tx
      .insert(deviceRemovals)
      .values({ userId, deviceId, kind: "self", actorId: userId, createdAt: now });
    return { ok: true, deleted } as const;
  });
  if (!result.ok) return result;
  await purgeSessionCache(result.deleted);
  return { ok: true };
}

/** Admin reset: revokes every active device, ends their sessions, and audits it. Returns how many devices were revoked. */
export async function resetDevices(userId: string, actorId: string): Promise<number> {
  const { revoked, deleted } = await db().transaction(async (tx) => {
    await lockUserDevices(tx, userId);
    const now = clock.now();
    const rows = await tx
      .update(devices)
      .set({ revokedAt: now, revokedReason: "admin" })
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
      .returning({ id: devices.id });
    const ids = rows.map((r) => r.id);
    const gone = await deleteDeviceSessions(tx, ids);
    if (ids.length > 0) {
      await tx.insert(deviceRemovals).values(
        ids.map((id) => ({
          userId,
          deviceId: id,
          kind: "admin" as const,
          actorId,
          createdAt: now,
        })),
      );
    }
    await writeAudit(tx, {
      actorId,
      action: "device.reset",
      subjectType: "user",
      subjectId: userId,
      after: { revoked: ids.length },
    });
    return { revoked: ids.length, deleted: gone };
  });
  await purgeSessionCache(deleted);
  return revoked;
}

/** Revokes devices idle for 30 days and deletes their sessions. Returns the revoked device ids. */
export async function expireDevices(): Promise<string[]> {
  const now = clock.now();
  const cutoff = new Date(now.getTime() - DEVICE_EXPIRY_MS);
  const { ids, deleted } = await db().transaction(async (tx) => {
    const rows = await tx
      .update(devices)
      .set({ revokedAt: now, revokedReason: "expired" })
      .where(and(isNull(devices.revokedAt), lt(devices.lastSeenAt, cutoff)))
      .returning({ id: devices.id });
    const revokedIds = rows.map((r) => r.id);
    return { ids: revokedIds, deleted: await deleteDeviceSessions(tx, revokedIds) };
  });
  await purgeSessionCache(deleted);
  return ids;
}

/** Who hears a support request: verified admins for now; A6 extends this with the student's linked parents. */
export async function supportRecipients(_userId: string): Promise<string[]> {
  const rows = await db()
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        eq(users.status, "active"),
        isNotNull(users.emailVerifiedAt),
        isNotNull(users.email),
      ),
    );
  return rows.flatMap((r) => (r.email ? [r.email] : []));
}
