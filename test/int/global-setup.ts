import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { TEMPLATE_DB, testDatabaseUrl, withDatabase } from "./db-url";

// Rebuilds the template database `alnamer_tpl` once per run; workers clone it.
export default async function setup(): Promise<void> {
  const adminUrl = testDatabaseUrl();
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${TEMPLATE_DB} and pid <> pg_backend_pid()`;
    await admin.unsafe(`drop database if exists ${TEMPLATE_DB}`);
    await admin.unsafe(`create database ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }

  const template = postgres(withDatabase(adminUrl, TEMPLATE_DB), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(template), {
      migrationsFolder: "src/server/db/migrations",
      migrationsTable: "__alnamer_migrations",
    });
  } finally {
    await template.end();
  }
}
