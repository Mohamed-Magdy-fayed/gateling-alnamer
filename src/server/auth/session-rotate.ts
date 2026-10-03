import "server-only";
import { eq } from "drizzle-orm";
import { sessions } from "@/server/db/schema";
import { randomToken, sha256 } from "./password";
import { deleteUserSessionsIn, type SessionTx } from "./session-invalidate";

export type RotatedSession = { token: string; expiresAt: Date };

/**
 * Transactional core of "change password": gives the calling session a fresh token and id (same
 * user, device, expiry and two-factor state) and deletes every other session row of the user, the
 * old one included. Returns the deleted token hashes for the post-commit cache purge and the new
 * token for the cookie, or `rotated: null` when the caller's session row is gone (everything is
 * deleted). Cookie and cache work belong after the commit, never inside it.
 */
export async function rotateAndRevokeIn(
  tx: SessionTx,
  userId: string,
  currentTokenHash: string | undefined,
): Promise<{ rotated: RotatedSession | null; deletedHashes: string[] }> {
  const [current] = currentTokenHash
    ? await tx.select().from(sessions).where(eq(sessions.tokenHash, currentTokenHash)).limit(1)
    : [];
  if (!current || current.userId !== userId) {
    return { rotated: null, deletedHashes: await deleteUserSessionsIn(tx, userId) };
  }
  const token = randomToken();
  const tokenHash = sha256(token);
  await tx.insert(sessions).values({
    tokenHash,
    userId,
    deviceId: current.deviceId,
    twoFactorVerified: current.twoFactorVerified,
    lastSeenAt: current.lastSeenAt,
    expiresAt: current.expiresAt,
  });
  const deletedHashes = await deleteUserSessionsIn(tx, userId, tokenHash);
  return { rotated: { token, expiresAt: current.expiresAt }, deletedHashes };
}
