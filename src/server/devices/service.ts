import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { writeAudit } from "@/server/audit/repository";
import { cacheDeleteUser } from "@/server/auth/session-cache";
import { clock } from "@/server/clock";
import { MAX_SESSIONS_PER_DEVICE, SESSION_LAST_SEEN_INTERVAL_MS } from "@/server/config/policy";
import { db } from "@/server/db";
import {
  auditLog,
  deviceRemovals,
  devices,
  parentLinks,
  preSessions,
  sessions,
  type UserRole,
  users,
} from "@/server/db/schema";
import { readPlatformSettings } from "@/server/settings/repository";
import { cairoDay } from "./day";
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

/** The register decision and its writes; the caller holds the user's advisory lock inside `tx`. */
async function registerInTx(
  tx: Tx,
  userId: string,
  deviceKey: string,
  userAgent: string | null,
): Promise<RegisterResult> {
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
    return registerInTx(tx, userId, deviceKey, userAgent);
  });
}

/** Updates the device (and optionally its session) last_seen_at when older than 5 minutes. Returns whether it wrote. */
export async function touchDevice(deviceId: string, sessionTokenHash?: string): Promise<boolean> {
  const now = clock.now();
  const cutoff = new Date(now.getTime() - SESSION_LAST_SEEN_INTERVAL_MS);
  const stale = and(
    eq(devices.id, deviceId),
    isNull(devices.revokedAt),
    lt(devices.lastSeenAt, cutoff),
  );
  const touch = (executor: Pick<Tx, "update">) =>
    executor.update(devices).set({ lastSeenAt: now }).where(stale).returning({ id: devices.id });
  // The common path has no session row to update: one statement, no transaction.
  if (!sessionTokenHash) return (await touch(db())).length > 0;
  return db().transaction(async (tx) => {
    if ((await touch(tx)).length === 0) return false;
    await tx
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.tokenHash, sessionTokenHash));
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

type OwnRemoval =
  | { ok: true; deleted: { userId: string; tokenHash: string }[] }
  | { ok: false; reason: "not_found" | "is_current" }
  | { ok: false; reason: "throttled"; nextAt: Date };

/** Checks and applies a self removal inside `tx`; the caller holds the user's advisory lock. */
async function revokeOwnDevice(
  tx: Tx,
  input: { userId: string; deviceId: string; currentDeviceKey: string },
): Promise<OwnRemoval> {
  const { userId, deviceId, currentDeviceKey } = input;
  const [device] = await tx
    .select({ id: devices.id, deviceKey: devices.deviceKey })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
    .limit(1);
  if (!device) return { ok: false, reason: "not_found" };
  if (device.deviceKey === currentDeviceKey) return { ok: false, reason: "is_current" };

  const [lastSelf] = await tx
    .select({ kind: deviceRemovals.kind, createdAt: deviceRemovals.createdAt })
    .from(deviceRemovals)
    .where(and(eq(deviceRemovals.userId, userId), eq(deviceRemovals.kind, "self")))
    .orderBy(desc(deviceRemovals.createdAt))
    .limit(1);
  const nextAt = policyNextSelfRemovalAt(lastSelf ? [lastSelf] : [], clock.now());
  if (nextAt) return { ok: false, reason: "throttled", nextAt };

  const now = clock.now();
  await tx
    .update(devices)
    .set({ revokedAt: now, revokedReason: "self" })
    .where(eq(devices.id, deviceId));
  const deleted = await deleteDeviceSessions(tx, [deviceId]);
  await tx
    .insert(deviceRemovals)
    .values({ userId, deviceId, kind: "self", actorId: userId, createdAt: now });
  return { ok: true, deleted };
}

/** Self removal: revokes one of the student's own devices, signs it out, and starts the 7-day throttle. */
export async function removeDevice(input: {
  userId: string;
  deviceId: string;
  /** The cookie key of the device making the request; it cannot remove itself. */
  currentDeviceKey: string;
}): Promise<RemoveDeviceResult> {
  const result = await db().transaction(async (tx) => {
    await lockUserDevices(tx, input.userId);
    return revokeOwnDevice(tx, input);
  });
  if (!result.ok) return result;
  await purgeSessionCache(result.deleted);
  return { ok: true };
}

export type RemoveAndRegisterResult =
  | { ok: true; deviceId: string }
  | { ok: false; reason: "not_found" | "is_current" | "blocked" | "expired" }
  | { ok: false; reason: "throttled"; nextAt: Date };

/** Thrown inside the transaction to roll it back when the current device would still be blocked. */
class StillBlocked extends Error {}

/**
 * Re-checked inside the removal's transaction: a password reset or sign-out-everywhere deletes the
 * pre-session, and a suspended account must not get a session from one that was issued earlier.
 */
async function preSessionStillValid(tx: Tx, userId: string, tokenHash: string): Promise<boolean> {
  const [row] = await tx
    .select({ status: users.status })
    .from(preSessions)
    .innerJoin(users, eq(users.id, preSessions.userId))
    .where(
      and(
        eq(preSessions.tokenHash, tokenHash),
        eq(preSessions.userId, userId),
        gt(preSessions.expiresAt, clock.now()),
      ),
    )
    .limit(1);
  return row?.status === "active";
}

/**
 * The block screen's remove: the self removal and the current device's registration in ONE
 * transaction under the user's advisory lock. When registration would still block, nothing is
 * committed, so the 7-day throttle is not spent. The caller then creates the session.
 */
export async function removeAndRegister(input: {
  userId: string;
  deviceId: string;
  currentDeviceKey: string;
  userAgent: string | null;
  /** The pre-session the request came with; it must still exist and the account must still be active. */
  preSessionTokenHash: string;
}): Promise<RemoveAndRegisterResult> {
  const { userId, currentDeviceKey, userAgent } = input;
  try {
    const result = await db().transaction(async (tx) => {
      await lockUserDevices(tx, userId);
      if (!(await preSessionStillValid(tx, userId, input.preSessionTokenHash))) {
        return { ok: false, reason: "expired" } as const;
      }
      const removal = await revokeOwnDevice(tx, input);
      if (!removal.ok) return removal;
      const registered = await registerInTx(tx, userId, currentDeviceKey, userAgent);
      if (registered.outcome === "block" || !registered.deviceId) throw new StillBlocked();
      return { ok: true, deviceId: registered.deviceId, deleted: removal.deleted } as const;
    });
    if (!result.ok) return result;
    await purgeSessionCache(result.deleted);
    return { ok: true, deviceId: result.deviceId };
  } catch (error) {
    if (error instanceof StillBlocked) return { ok: false, reason: "blocked" };
    throw error;
  }
}

/**
 * D34: a device keeps at most MAX_SESSIONS_PER_DEVICE sessions, because sharing the `did` cookie
 * would otherwise let several machines count as one device. Revokes the oldest beyond the cap and
 * audits `device.session_cap` once per Cairo day per device. Returns how many sessions it ended.
 */
export async function capDeviceSessions(userId: string, deviceId: string): Promise<number> {
  const day = cairoDay(clock.now());
  const deleted = await db().transaction(async (tx) => {
    await lockUserDevices(tx, userId);
    const surplus = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.deviceId, deviceId))
      .orderBy(desc(sessions.createdAt), desc(sessions.id))
      .offset(MAX_SESSIONS_PER_DEVICE);
    if (surplus.length === 0) return [];
    const gone = await tx
      .delete(sessions)
      .where(
        inArray(
          sessions.id,
          surplus.map((row) => row.id),
        ),
      )
      .returning({ userId: sessions.userId, tokenHash: sessions.tokenHash });
    const [already] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "device.session_cap"),
          eq(auditLog.subjectId, deviceId),
          sql`${auditLog.after}->>'day' = ${day}`,
        ),
      )
      .limit(1);
    if (!already) {
      await writeAudit(tx, {
        actorId: userId,
        action: "device.session_cap",
        subjectType: "device",
        subjectId: deviceId,
        after: { day, revoked: gone.length },
      });
    }
    return gone;
  });
  await purgeSessionCache(deleted);
  return deleted.length;
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

export type DeviceListItem = { id: string; label: string | null; lastSeenAt: Date };

/** The student's active devices, most recently used first (the block screen's list). */
export async function listActiveDevices(userId: string): Promise<DeviceListItem[]> {
  return db()
    .select({ id: devices.id, label: devices.label, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
    .orderBy(desc(devices.lastSeenAt));
}

export type SupportContact = { email: string; locale: string | null };

/** Who hears a support request: verified admins and the student's linked parents (verified emails only). */
export async function supportContacts(userId: string): Promise<SupportContact[]> {
  const [admins, parents] = await Promise.all([adminContacts(), parentContacts(userId)]);
  const seen = new Set<string>();
  return [...admins, ...parents].filter((c) => {
    const key = c.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function parentContacts(studentId: string): Promise<SupportContact[]> {
  const rows = await db()
    .select({ email: users.email, locale: users.locale })
    .from(parentLinks)
    .innerJoin(users, eq(users.id, parentLinks.parentId))
    .where(
      and(
        eq(parentLinks.studentId, studentId),
        eq(users.role, "parent"),
        eq(users.status, "active"),
        isNotNull(users.emailVerifiedAt),
        isNotNull(users.email),
      ),
    );
  return rows.flatMap((r) => (r.email ? [{ email: r.email, locale: r.locale }] : []));
}

async function adminContacts(): Promise<SupportContact[]> {
  const rows = await db()
    .select({ email: users.email, locale: users.locale })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        eq(users.status, "active"),
        isNotNull(users.emailVerifiedAt),
        isNotNull(users.email),
      ),
    );
  return rows.flatMap((r) => (r.email ? [{ email: r.email, locale: r.locale }] : []));
}

export async function supportRecipients(userId: string): Promise<string[]> {
  return (await supportContacts(userId)).map((c) => c.email);
}

/** The only student details a support email shows: name and public number. */
export async function supportStudent(
  userId: string,
): Promise<{ name: string; publicNumber: string | null } | null> {
  const [row] = await db()
    .select({ name: users.name, publicNumber: users.publicNumber })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}
