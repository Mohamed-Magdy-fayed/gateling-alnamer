// Seeds one local account per existing role. Idempotent: existing users and credentials are kept.
// Local only: refused on Vercel and against any non-local database (`--test-db` targets db-test).
// Run through `npm run db:seed` (tsx --conditions=react-server lets the server-only helpers load).
import { loadLocalEnv, parseLocalArgs } from "./lib/local-env.mjs";

// Local development passwords only; the guards below keep them off deployed databases.
const SEED_PASSWORD = "Alnamer-local-1";
const ACCOUNTS = [
  { name: "Local Student", email: "student@alnamer.local", role: "student" },
  { name: "Local Parent", email: "parent@alnamer.local", role: "parent" },
  { name: "Local Teacher", email: "teacher@alnamer.local", role: "teacher" },
  { name: "Local Admin", email: "admin@alnamer.local", role: "admin" },
] as const;

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
const { credentials, users } = await import("../src/server/db/schema");
const { hashPassword } = await import("../src/server/auth/password");

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);
try {
  let created = 0;
  for (const account of ACCOUNTS) {
    const [user] = await db
      .insert(users)
      .values(account)
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    if (!user) continue;
    const passwordHash = await hashPassword(SEED_PASSWORD);
    await db.insert(credentials).values({ userId: user.id, passwordHash, passwordSalt: null });
    created += 1;
  }
  console.log(`Seeded ${ACCOUNTS.length} accounts (${created} new).`);
} finally {
  await client.end();
}
