// Shared by db:seed and db:seed:demo. Import dynamically, after the guards: it loads server modules.
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { hashPassword } from "../../src/server/auth/password";
import { nextPublicNumber } from "../../src/server/auth/public-number";
import { invalidateUserSessionsCore } from "../../src/server/auth/session-invalidate";
import { credentials, teacherProfiles, users } from "../../src/server/db/schema";

type Role = typeof users.$inferInsert.role;

export type SeedAccount = {
  name: string;
  email: string;
  role: NonNullable<Role>;
  isSuperAdmin?: boolean;
};

export type SeedOptions = {
  password: string;
  isSample: boolean;
  // true: rewrite the account's fields and password every run (demo). false: keep what exists (local).
  refresh: boolean;
};

// Adults, so no guardian consent is needed.
const ADULT_DATE_OF_BIRTH = "1990-01-01";

export type SeedResult = { userId: string; created: boolean };

export async function upsertAccount(
  db: PostgresJsDatabase,
  account: SeedAccount,
  options: SeedOptions,
): Promise<SeedResult> {
  const passwordHash = await hashPassword(options.password);
  const result = await db.transaction(async (tx) => {
    const fields = {
      name: account.name,
      role: account.role,
      isSample: options.isSample,
      isSuperAdmin: account.isSuperAdmin ?? false,
      status: "active" as const,
      dateOfBirth: ADULT_DATE_OF_BIRTH,
    };
    const [existing] = await tx
      .select({ id: users.id, publicNumber: users.publicNumber })
      .from(users)
      .where(eq(users.email, account.email));
    let userId: string;
    if (existing) {
      userId = existing.id;
      const publicNumber = existing.publicNumber ?? (await nextPublicNumber(tx));
      await tx
        .update(users)
        .set(options.refresh ? { ...fields, publicNumber } : { publicNumber })
        .where(eq(users.id, userId));
    } else {
      const [created] = await tx
        .insert(users)
        .values({ ...fields, email: account.email, publicNumber: await nextPublicNumber(tx) })
        .returning({ id: users.id });
      if (!created) throw new Error("user insert returned no row");
      userId = created.id;
    }

    const credentialQuery = tx
      .insert(credentials)
      .values({ userId, passwordHash, passwordSalt: null });
    if (options.refresh) {
      await credentialQuery.onConflictDoUpdate({
        target: credentials.userId,
        set: { passwordHash, passwordSalt: null, updatedAt: new Date() },
      });
    } else {
      await credentialQuery.onConflictDoNothing({ target: credentials.userId });
    }

    if (account.role === "teacher") {
      await tx
        .insert(teacherProfiles)
        .values({
          userId,
          publicName: { ar: account.name, en: account.name },
          bio: { ar: "معلم تجريبي", en: "Sample teacher" },
          status: "approved",
          isSample: options.isSample,
        })
        .onConflictDoUpdate({
          target: teacherProfiles.userId,
          set: { status: "approved", isSample: options.isSample },
        });
    }
    return { userId, created: !existing };
  });
  // A refreshed account is signed out everywhere (its password just changed).
  if (options.refresh) await invalidateUserSessionsCore(result.userId);
  return result;
}
