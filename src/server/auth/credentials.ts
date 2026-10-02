import "server-only";
import { and, eq } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { credentials, users } from "@/server/db/schema";
import { hashPassword, isLegacyHash, verifyDummy, verifyPassword } from "./password";

type Database = ReturnType<typeof db>;

/** An identifier containing "@" is an email; anything else is a username. Both are trimmed (columns are citext). */
export function identifierCondition(identifier: string) {
  const value = identifier.trim();
  return value.includes("@") ? eq(users.email, value) : eq(users.username, value.toLowerCase());
}

/**
 * Checks an email or username and a password. Returns the user id, or null for every failure
 * (unknown user, wrong password, suspended account). Exactly one password verify runs whatever the
 * outcome; the account status is read after it so timing does not reveal a suspension.
 * A legacy scrypt credential is rehashed to argon2id (salt cleared) only while the stored hash is
 * still the one we verified, so a reset that lands in between is never overwritten.
 */
export async function authenticate(
  identifier: string,
  password: string,
  conn: Database = db(),
): Promise<string | null> {
  const user = await conn.query.users.findFirst({
    columns: { id: true, status: true },
    where: identifierCondition(identifier),
    with: { credentials: { columns: { passwordHash: true, passwordSalt: true } } },
  });
  const credential = user?.credentials;
  if (!user || !credential) return verifyDummy(password).then(() => null);
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
