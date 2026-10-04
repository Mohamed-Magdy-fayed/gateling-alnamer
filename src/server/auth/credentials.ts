import "server-only";
import { and, eq } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { credentials, users } from "@/server/db/schema";
import { hashPassword, isLegacyHash, verifyDummy, verifyPassword } from "./password";

type Database = ReturnType<typeof db>;

/**
 * Sets or replaces a user's password: an argon2id hash (made by the caller, outside any lock),
 * the legacy salt cleared. Runs on the caller's transaction so the write commits with whatever
 * goes with it (a spent code, ended sessions, an audit row).
 */
export async function setPasswordIn(
  executor: Pick<Database, "insert">,
  userId: string,
  passwordHash: string,
): Promise<void> {
  const now = clock.now();
  await executor
    .insert(credentials)
    .values({ userId, passwordHash, passwordSalt: null, updatedAt: now })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: { passwordHash, passwordSalt: null, updatedAt: now },
    });
}

/** An identifier containing "@" is an email; anything else is a username. Both are trimmed (columns are citext). */
export function identifierCondition(identifier: string) {
  const value = identifier.trim();
  return value.includes("@") ? eq(users.email, value) : eq(users.username, value.toLowerCase());
}

/**
 * Checks an email or username and a password. Returns the user id, or null for every failure
 * (unknown user, wrong password, suspended account, a sample account when `appMode` is "live"). Exactly one password verify runs whatever the
 * outcome; the account status is read after it so timing does not reveal a suspension.
 * A legacy scrypt credential is rehashed to argon2id (salt cleared) only while the stored hash is
 * still the one we verified, so a reset that lands in between is never overwritten.
 */
export async function authenticate(
  identifier: string,
  password: string,
  conn: Database = db(),
  appMode: string | undefined = process.env.APP_MODE,
): Promise<string | null> {
  const user = await conn.query.users.findFirst({
    columns: { id: true, status: true, isSample: true },
    where: identifierCondition(identifier),
    with: { credentials: { columns: { passwordHash: true, passwordSalt: true } } },
  });
  const credential = user?.credentials;
  if (!user || !credential) return verifyDummy(password).then(() => null);
  // Demo accounts cannot sign in on the real site; same cost and same answer as a wrong password.
  if (user.isSample && appMode === "live") return verifyDummy(password).then(() => null);
  // A legacy credential without a salt cannot verify; it still costs one hash like every other failure.
  if (isLegacyHash(credential) && !credential.passwordSalt) {
    return verifyDummy(password).then(() => null);
  }
  if (!(await verifyPassword(password, credential))) return null;
  if (user.status !== "active") return null;

  if (isLegacyHash(credential)) {
    const passwordHash = await hashPassword(password);
    const rehashed = await conn
      .update(credentials)
      .set({ passwordHash, passwordSalt: null, updatedAt: clock.now() })
      .where(
        and(eq(credentials.userId, user.id), eq(credentials.passwordHash, credential.passwordHash)),
      )
      .returning({ userId: credentials.userId });
    // Someone reset the password after we read it: the password we just verified is no longer valid.
    if (rehashed.length === 0) return null;
  }
  return user.id;
}
