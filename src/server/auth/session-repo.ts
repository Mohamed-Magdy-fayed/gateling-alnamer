import "server-only";
import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "@/server/db";
import { sessions, type User, users } from "@/server/db/schema";

/** A live session joined to its user: everything the session cache holds. */
export type SessionRecord = {
  userId: string;
  name: string;
  email: string | null;
  role: User["role"];
  status: User["status"];
  expiresAt: Date;
  deviceId: string | null;
  twoFactorVerified: boolean;
  lastSeenAt: Date | null;
};

export async function findSession(tokenHash: string, now: Date): Promise<SessionRecord | null> {
  const [row] = await db()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      expiresAt: sessions.expiresAt,
      deviceId: sessions.deviceId,
      twoFactorVerified: sessions.twoFactorVerified,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  return row ?? null;
}

export async function insertSession(values: {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  deviceId?: string | null;
  twoFactorVerified?: boolean;
}): Promise<void> {
  await db().insert(sessions).values(values);
}

/** Returns how many rows changed: 0 means the session row is gone (revoked or expired and swept). */
export async function updateSession(
  tokenHash: string,
  patch: { expiresAt?: Date; lastSeenAt?: Date },
): Promise<number> {
  const rows = await db()
    .update(sessions)
    .set(patch)
    .where(eq(sessions.tokenHash, tokenHash))
    .returning({ tokenHash: sessions.tokenHash });
  return rows.length;
}

/** Binds a session to a device; returns how many rows changed (0: the session is gone). */
export async function setSessionDevice(tokenHash: string, deviceId: string): Promise<number> {
  const rows = await db()
    .update(sessions)
    .set({ deviceId })
    .where(eq(sessions.tokenHash, tokenHash))
    .returning({ tokenHash: sessions.tokenHash });
  return rows.length;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Deletes a user's sessions (all but `exceptTokenHash`) and returns the deleted token hashes. */
export async function deleteUserSessions(
  userId: string,
  exceptTokenHash?: string,
): Promise<string[]> {
  const where = exceptTokenHash
    ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, exceptTokenHash))
    : eq(sessions.userId, userId);
  const rows = await db()
    .delete(sessions)
    .where(where)
    .returning({ tokenHash: sessions.tokenHash });
  return rows.map((row) => row.tokenHash);
}
