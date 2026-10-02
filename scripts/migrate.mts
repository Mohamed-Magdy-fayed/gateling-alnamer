// Applies generated migrations. Used by `npm run db:migrate` locally (with `.env`)
// and by `vercel-build` on Vercel (with the scope's own DATABASE_URL).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadLocalEnv, parseLocalArgs } from "./lib/local-env.mjs";
import { pickMigrationUrl, withMigrationLock } from "./lib/migrate-core.mjs";

// Locally the guard refuses a non-local DATABASE_URL (`--test-db` targets the db-test container).
if (!process.env.VERCEL) {
  try {
    loadLocalEnv(parseLocalArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`db:migrate: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

// Session advisory locks need a direct connection; Neon's Vercel integration sets DATABASE_URL_UNPOOLED.
// The local guard above already vetted whichever of the two is used.
const url = pickMigrationUrl(process.env);
if (!url) {
  console.error("DATABASE_URL is not set; cannot migrate.");
  process.exit(1);
}

// Serialises concurrent deploys/runs: the lock lives on the single connection below.
const MIGRATION_LOCK_KEY = 7461201;

const client = postgres(url, { max: 1, onnotice: () => {} });
await withMigrationLock({
  lock: () => client`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`,
  unlock: () => client`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`,
  end: () => client.end(),
  work: async () => {
    await migrate(drizzle(client), {
      migrationsFolder: "src/server/db/migrations",
      migrationsTable: "__alnamer_migrations",
    });
    console.log("Migrations applied.");
  },
});
