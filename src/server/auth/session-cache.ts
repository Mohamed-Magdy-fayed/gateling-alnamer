import "server-only";
import { z } from "zod";
import { SESSION_CACHE_TTL_SEC } from "@/server/config/policy";
import { getRedis } from "@/server/redis";
import type { SessionRecord } from "./session-repo";

const sessionKey = (tokenHash: string) => `sess:${tokenHash}`;
const userKey = (userId: string) => `usess:${userId}`;

const entrySchema = z.object({
  userId: z.string(),
  role: z.enum(["student", "parent", "teacher", "admin", "reviewer"]),
  name: z.string(),
  email: z.string().nullable(),
  status: z.enum(["active", "suspended"]),
  expiresAt: z.string(),
  deviceId: z.string().nullable(),
  twoFactorVerified: z.boolean(),
  lastSeenAt: z.string().nullable(),
});

function logRedisError(op: string, error: unknown): void {
  console.error(`Session cache ${op} failed`, error instanceof Error ? error.message : error);
}

/** Cached session, or null on miss, no Redis, a bad payload or any Redis error (reads fail open to the DB). */
export async function cacheGet(tokenHash: string): Promise<SessionRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<unknown>(sessionKey(tokenHash));
    if (raw === null || raw === undefined) return null;
    const parsed = entrySchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
    if (!parsed.success) return null;
    const { expiresAt, lastSeenAt, ...rest } = parsed.data;
    return {
      ...rest,
      expiresAt: new Date(expiresAt),
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt) : null,
    };
  } catch (error) {
    logRedisError("read", error);
    return null;
  }
}

export async function cacheSet(tokenHash: string, record: SessionRecord): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const key = sessionKey(tokenHash);
  const payload = JSON.stringify({
    ...record,
    expiresAt: record.expiresAt.toISOString(),
    lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
  });
  try {
    await redis.set(key, payload, { ex: SESSION_CACHE_TTL_SEC });
    await redis.sadd(userKey(record.userId), key);
    await redis.expire(userKey(record.userId), SESSION_CACHE_TTL_SEC * 2);
  } catch (error) {
    logRedisError("write", error);
  }
}

/** Drops one session's cache entry (sign-out, rotation). */
export async function cacheDelete(tokenHash: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(sessionKey(tokenHash));
  } catch (error) {
    logRedisError("delete", error);
  }
}

/**
 * Drops a user's cached sessions: first `deletedHashes` (the rows the DB delete just removed, their
 * own try so an index failure cannot spare them), then every key in `usess:<userId>`, sparing
 * `exceptTokenHash`. A failure is logged, not thrown: the DB rows are already gone, so a stale entry
 * lives at most one TTL.
 */
export async function cacheDeleteUser(
  userId: string,
  deletedHashes: string[],
  exceptTokenHash?: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const except = exceptTokenHash ? sessionKey(exceptTokenHash) : null;

  try {
    const known = deletedHashes.map(sessionKey).filter((key) => key !== except);
    if (known.length > 0) await redis.del(...known);
  } catch (error) {
    logRedisError("invalidate", error);
  }

  try {
    const keys = new Set(await redis.smembers(userKey(userId)));
    if (except) keys.delete(except);
    if (keys.size > 0) await redis.del(...keys);
    if (except) {
      if (keys.size > 0) await redis.srem(userKey(userId), ...keys);
    } else {
      await redis.del(userKey(userId));
    }
  } catch (error) {
    logRedisError("invalidate", error);
  }
}
