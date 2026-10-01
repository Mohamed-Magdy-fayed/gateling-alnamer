// Applies generated migrations. Used by `npm run db:migrate` locally (with `.env`)
// and by `vercel-build` on Vercel (with the scope's own DATABASE_URL).
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

if (!process.env.VERCEL) config({ path: ".env" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set; cannot migrate.");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), {
    migrationsFolder: "src/server/db/migrations",
    migrationsTable: "__alnamer_migrations",
  });
  console.log("Migrations applied.");
} finally {
  await client.end();
}
