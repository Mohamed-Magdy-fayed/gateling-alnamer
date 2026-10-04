// Shared by db:seed and db:seed:demo: a confirmed TOTP for seeded staff accounts (A4), so they can
// pass two-factor sign-in. Import dynamically, after the guards: it loads server modules.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { authKey } from "../../src/server/auth/keys";
import { seal } from "../../src/server/auth/secret-box";
import { base32Decode } from "../../src/server/auth/totp";
import { totpSecrets } from "../../src/server/db/schema";

/** Sets (or replaces) the account's confirmed TOTP secret. Never prints the secret. */
export async function seedStaffTotp(
  db: PostgresJsDatabase,
  userId: string,
  secretBase32: string,
): Promise<void> {
  // Fails loudly on a malformed secret instead of storing one no app can match.
  if (base32Decode(secretBase32).length < 10) throw new Error("TOTP secret is too short");
  const sealed = seal(authKey("totp"), secretBase32.replace(/\s/g, "").toUpperCase());
  await db
    .insert(totpSecrets)
    .values({ userId, secretEnc: sealed, confirmedAt: new Date() })
    .onConflictDoUpdate({
      target: totpSecrets.userId,
      set: { secretEnc: sealed, confirmedAt: new Date(), lastStep: null },
    });
}
