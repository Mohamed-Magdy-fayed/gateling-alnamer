import "server-only";
import type { db } from "@/server/db";
import { cacheDeleteUser } from "./session-cache";
import { deleteUserSessions } from "./session-repo";

type Database = ReturnType<typeof db>;
/** The handle a Drizzle transaction callback receives. */
export type SessionTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The revocation body shared by `invalidateUserSessions` and the demo seed (a script cannot load
 * `session.ts`, which pulls in `next/headers`): deletes the user's session rows and cache keys,
 * optionally sparing one session.
 */
export async function invalidateUserSessionsCore(
  userId: string,
  options: { exceptTokenHash?: string } = {},
): Promise<void> {
  const deleted = await deleteUserSessions(userId, options.exceptTokenHash);
  await cacheDeleteUser(userId, deleted, options.exceptTokenHash);
}

/**
 * Transactional half of a revocation: deletes the session rows inside `tx` and returns the token
 * hashes. Once the transaction commits, the caller runs `purgeSessionCache` with them.
 */
export function deleteUserSessionsIn(
  tx: SessionTx,
  userId: string,
  exceptTokenHash?: string,
): Promise<string[]> {
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
