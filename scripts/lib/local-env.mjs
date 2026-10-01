// Shared by build-local and start-local. Next auto-loads `.env.production.local` on any
// production build/start, and never overrides keys already in process.env, so `.env` is
// forced first. The database guard stops a local build or server from touching a deployed DB.
import path from "node:path";
import { config } from "dotenv";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "host.docker.internal"]);

// Messages name the key only, never the value (it holds credentials).
export function assertLocalDatabase(env) {
  const raw = env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is not set in .env; local scripts need a local database.");
  }
  let hostname;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error("DATABASE_URL in .env is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(hostname.toLowerCase())) {
    throw new Error(
      "DATABASE_URL in .env does not point at a local host (localhost, 127.0.0.1, [::1], host.docker.internal); refusing to run against it.",
    );
  }
}

export function loadLocalEnv({
  cwd = process.cwd(),
  env = process.env,
  requireLocalDatabase = true,
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
  if (requireLocalDatabase) assertLocalDatabase(env);
  return env;
}
