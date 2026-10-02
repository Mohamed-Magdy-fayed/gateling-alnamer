import "server-only";
import { eq } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { credentials, users } from "@/server/db/schema";
import { hashPassword, isLegacyHash, verifyDummy, verifyPassword } from "./password";

type Database = ReturnType<typeof db>;

/**
 * Checks an email and password. Returns the user id, or null for every failure.
 * Exactly one password verify runs whether the user is unknown or the password is wrong.
 * A legacy scrypt credential is rehashed to argon2id (salt cleared) in the same transaction.
 */
export async function authenticate(
  email: string,
  password: string,
  conn: Database = db(),
): Promise<string | null> {
  const user = await conn.query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, email),
    with: { credentials: { columns: { passwordHash: true, passwordSalt: true } } },
  });
  const credential = user?.credentials;
  if (!user || !credential) return verifyDummy(password).then(() => null);
  if (!(await verifyPassword(password, credential))) return null;

  if (isLegacyHash(credential)) {
    const passwordHash = await hashPassword(password);
    await conn.transaction(async (tx) => {
      await tx
        .update(credentials)
        .set({ passwordHash, passwordSalt: null, updatedAt: clock.now() })
        .where(eq(credentials.userId, user.id));
    });
  }
  return user.id;
}
