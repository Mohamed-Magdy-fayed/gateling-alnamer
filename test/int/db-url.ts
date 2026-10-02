import { assertLocalDatabase, DEFAULT_TEST_DATABASE_URL } from "../../scripts/lib/local-env.mjs";

export const TEMPLATE_DB = "alnamer_tpl";

// Resolves TEST_DATABASE_URL (default: the db-test container) and refuses a non-local host.
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  assertLocalDatabase({ TEST_DATABASE_URL: url }, "TEST_DATABASE_URL");
  return url;
}

// Same server and credentials, different database.
export function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}
