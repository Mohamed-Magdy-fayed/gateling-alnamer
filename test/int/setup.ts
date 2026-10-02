import postgres from "postgres";
import { TEMPLATE_DB, testDatabaseUrl, withDatabase } from "./db-url";

// Per worker: a fresh database cloned from the template, exposed as DATABASE_URL.
const adminUrl = testDatabaseUrl();
const workerDb = `alnamer_w${process.env.VITEST_POOL_ID ?? "0"}`;

const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
try {
  await admin.unsafe(`drop database if exists ${workerDb} with (force)`);
  await admin.unsafe(`create database ${workerDb} template ${TEMPLATE_DB}`);
} finally {
  await admin.end();
}

process.env.DATABASE_URL = withDatabase(adminUrl, workerDb);
