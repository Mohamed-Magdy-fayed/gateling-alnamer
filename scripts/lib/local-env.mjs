// Shared by build-local, start-local and db:migrate. Next auto-loads `.env.production.local` on
// any production build/start, and never overrides keys already in process.env, so `.env` is
// forced first. The database guard stops a local script from touching a deployed DB.
// `--test-db` swaps DATABASE_URL for the throwaway `db-test` container (docker-compose.yml).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { config, parse } from "dotenv";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "host.docker.internal"]);

export const DEFAULT_TEST_DATABASE_URL =
  "postgres://alnamer_test:alnamer_test@localhost:5433/alnamer_test";

export function parseLocalArgs(argv) {
  return { useTestDatabase: argv.includes("--test-db") };
}

// Messages name the key only, never the value (it holds credentials).
export function assertLocalDatabase(env, key = "DATABASE_URL") {
  const raw = env[key];
  if (!raw) {
    throw new Error(`${key} is not set in .env; local scripts need a local database.`);
  }
  let hostname;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error(`${key} in .env is not a valid URL.`);
  }
  if (!LOCAL_HOSTS.has(hostname.toLowerCase())) {
    throw new Error(
      `${key} in .env does not point at a local host (localhost, 127.0.0.1, [::1], host.docker.internal); refusing to run against it.`,
    );
  }
}

export function loadLocalEnv({
  cwd = process.cwd(),
  env = process.env,
  requireLocalDatabase = true,
  useTestDatabase = false,
} = {}) {
  const result = config({
    path: path.join(cwd, ".env"),
    override: true,
    processEnv: env,
    quiet: true,
  });
  if (result.error) {
    throw new Error(
      `Could not read .env (${result.error.code ?? "error"}); run npm run env:init first.`,
    );
  }
  if (useTestDatabase) {
    env.TEST_DATABASE_URL = env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
    env.DATABASE_URL = env.TEST_DATABASE_URL;
    // migrate prefers the direct url; a leftover one from .env must not outrank the test database.
    delete env.DATABASE_URL_UNPOOLED;
    if (requireLocalDatabase) assertLocalDatabase(env, "TEST_DATABASE_URL");
    return env;
  }
  if (requireLocalDatabase) {
    assertLocalDatabase(env);
    if (env.DATABASE_URL_UNPOOLED) assertLocalDatabase(env, "DATABASE_URL_UNPOOLED");
  }
  return env;
}

// Key names declared in the env schema (top-level `KEY:` entries of the z.object).
function schemaKeys() {
  const file = path.join(import.meta.dirname, "..", "..", "src", "server", "env-schema.ts");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]);
}

// Key names only, from every `.env*` file in cwd; values are discarded immediately.
function envFileKeys(cwd) {
  return readdirSync(cwd)
    .filter((name) => name.startsWith(".env"))
    .flatMap((name) => Object.keys(parse(readFileSync(path.join(cwd, name), "utf8"))));
}

// Next fills any key missing from process.env out of `.env.production.local` / `.env.preview.local`
// but never overrides a key that is already set (even to ""). Setting every key `.env` lacks to ""
// keeps the child process off those files. Returns a copy; `env` is not mutated.
export function sanitizedChildEnv({ cwd = process.cwd(), env = process.env } = {}) {
  const defined = new Set(Object.keys(parse(readFileSync(path.join(cwd, ".env"), "utf8"))));
  const child = { ...env };
  for (const key of new Set([...schemaKeys(), ...envFileKeys(cwd)])) {
    if (!defined.has(key)) child[key] = "";
  }
  return child;
}
