// Seeds one local account per role plus a super admin. Idempotent: existing users and credentials are kept.
// Local only: refused on Vercel and against any non-local database (`--test-db` targets db-test).
// Run through `npm run db:seed` (tsx --conditions=react-server lets the server-only helpers load).

import { loadLocalEnv, parseLocalArgs } from "./lib/local-env.mjs";
import type { SeedAccount } from "./lib/seed-accounts.mts";

// Local development passwords only; the guards below keep them off deployed databases.
const SEED_PASSWORD = "Alnamer-local-1";
// Fixed order number (Crockford base32) so re-running the seed finds the same sample order.
const LOCAL_SAMPLE_ORDER = "SAMPE001";
// Local development TOTP for seeded staff (teacher, reviewer, admins): add it to an authenticator
// app as a manual key. Local only, like SEED_PASSWORD.
const LOCAL_STAFF_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const STAFF_ROLES = new Set(["teacher", "reviewer", "admin"]);
const ACCOUNTS = [
  { name: "Local Student", email: "student@alnamer.local", role: "student" },
  { name: "Local Parent", email: "parent@alnamer.local", role: "parent" },
  { name: "Local Teacher", email: "teacher@alnamer.local", role: "teacher" },
  { name: "Local Reviewer", email: "reviewer@alnamer.local", role: "reviewer" },
  { name: "Local Admin", email: "admin@alnamer.local", role: "admin" },
  {
    name: "Local Super Admin",
    email: "superadmin@alnamer.local",
    role: "admin",
    isSuperAdmin: true,
  },
] as const satisfies readonly SeedAccount[];

if (process.env.VERCEL) {
  console.error("db:seed: refusing to run when VERCEL is set; seeding is local only.");
  process.exit(1);
}
try {
  loadLocalEnv(parseLocalArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`db:seed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:seed: DATABASE_URL is not set.");
  process.exit(1);
}

const { drizzle } = await import("drizzle-orm/postgres-js");
const { default: postgres } = await import("postgres");
const { upsertAccount } = await import("./lib/seed-accounts.mts");
const { seedSampleAttempt, seedSampleOrder } = await import("./lib/seed-orders.mts");
const { seedStaffTotp } = await import("./lib/seed-two-factor.mts");

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);
try {
  let created = 0;
  for (const account of ACCOUNTS) {
    const result = await upsertAccount(db, account, {
      password: SEED_PASSWORD,
      isSample: false,
      refresh: false,
    });
    if (result.created) created += 1;
    // The local student owns one sample course, so a paid lesson opens without a purchase.
    if (STAFF_ROLES.has(account.role)) await seedStaffTotp(db, result.userId, LOCAL_STAFF_TOTP);
    if (account.role === "student") {
      await seedSampleOrder(db, result.userId, LOCAL_SAMPLE_ORDER);
      await seedSampleAttempt(db, result.userId);
    }
  }
  console.log(`Seeded ${ACCOUNTS.length} accounts (${created} new).`);
} finally {
  await client.end();
}
