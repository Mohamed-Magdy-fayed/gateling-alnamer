import "server-only";
import { cacheDeleteUser } from "./session-cache";
import { deleteUserSessions } from "./session-repo";

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
