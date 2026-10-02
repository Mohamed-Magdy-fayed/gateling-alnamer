import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { randomToken, sha256 } from "@/server/auth/password";
import { clock } from "@/server/clock";
import { PRE_SESSION_TTL_MS } from "@/server/config/policy";
import { db } from "@/server/db";
import { preSessions } from "@/server/db/schema";

/** Not `__Host-` (that would force Path=/): the cookie is scoped to device management only. */
export const PRE_SESSION_COOKIE = "presession";
const PRE_SESSION_PATH = "/devices";

export type PreSession = { userId: string; deviceKey: string; tokenHash: string };

/**
 * A correct password on a device the limit blocks. It proves who the person is to device
 * management and nothing else: this file is the only reader of the cookie, and `getCurrentUser`
 * never looks at it. Call `issuePreSession` and `clearPreSession` from actions or route handlers.
 */
export async function issuePreSession(
  userId: string,
  deviceKey: string,
  { secure }: { secure: boolean },
): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(clock.now().getTime() + PRE_SESSION_TTL_MS);
  await db().transaction(async (tx) => {
    // One pending pre-session per user: a new blocked sign-in replaces the earlier one.
    await tx.delete(preSessions).where(eq(preSessions.userId, userId));
    await tx.insert(preSessions).values({ tokenHash: sha256(token), userId, deviceKey, expiresAt });
  });
  (await cookies()).set(PRE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: PRE_SESSION_PATH,
    expires: expiresAt,
  });
}

/** The unexpired pre-session for this request, or null. The only reader of the cookie. */
export async function getPreSession(): Promise<PreSession | null> {
  const token = (await cookies()).get(PRE_SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = sha256(token);
  const [row] = await db()
    .select({ userId: preSessions.userId, deviceKey: preSessions.deviceKey })
    .from(preSessions)
    .where(and(eq(preSessions.tokenHash, tokenHash), gt(preSessions.expiresAt, clock.now())))
    .limit(1);
  return row ? { ...row, tokenHash } : null;
}

/** Deletes the pre-session row and its cookie (after a successful removal, or on sign-out). */
export async function clearPreSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(PRE_SESSION_COOKIE)?.value;
  if (token)
    await db()
      .delete(preSessions)
      .where(eq(preSessions.tokenHash, sha256(token)));
  store.set(PRE_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: PRE_SESSION_PATH,
    maxAge: 0,
    expires: new Date(0),
  });
}
