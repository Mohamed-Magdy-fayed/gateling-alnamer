import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { preSessions } from "@/server/db/schema";
import { cacheDeleteUser } from "./session-cache";
import { deleteUserSessions } from "./session-repo";

type Database = ReturnType<typeof db>;
/** The handle a Drizzle transaction callback receives. */
export type SessionTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The revocation body shared by `invalidateUserSessions` and the demo seed (a script cannot load
 * `session.ts`, which pulls in `next/headers`): deletes the user's session rows and pre-sessions
 * in one transaction (A8 review L1: "sign out other sessions" and the admin two-factor reset must
 * also end a pending device removal), then the cache keys. One session can be spared.
 */
export async function invalidateUserSessionsCore(
  userId: string,
  options: { exceptTokenHash?: string } = {},
): Promise<void> {
  const deleted = await db().transaction((tx) =>
    deleteUserSessionsIn(tx, userId, options.exceptTokenHash),
  );
  await cacheDeleteUser(userId, deleted, options.exceptTokenHash);
}

/**
 * Transactional half of a revocation: deletes the session rows inside `tx` and returns the token
 * hashes. The user's pre-sessions (a correct password on a blocked device) die with them, so a
 * password reset or "sign out everywhere" also ends a pending device removal. Once the transaction
 * commits, the caller runs `purgeSessionCache` with the hashes.
 */
export async function deleteUserSessionsIn(
  tx: SessionTx,
  userId: string,
  exceptTokenHash?: string,
): Promise<string[]> {
  await tx.delete(preSessions).where(eq(preSessions.userId, userId));
  return deleteUserSessions(userId, exceptTokenHash, tx);
}

/** The cache half of a revocation, run after the transaction that deleted the rows committed. */
export function purgeSessionCache(
  userId: string,
  hashes: string[],
  exceptTokenHash?: string,
): Promise<void> {
  return cacheDeleteUser(userId, hashes, exceptTokenHash);
}
