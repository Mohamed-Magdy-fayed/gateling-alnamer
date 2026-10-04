// `next start` with `.env` forced and a local-database guard (see lib/local-env.mjs).
import { spawnSync } from "node:child_process";
import { loadLocalEnv, parseLocalArgs, sanitizedChildEnv } from "./lib/local-env.mjs";

const args = parseLocalArgs(process.argv.slice(2));
try {
  loadLocalEnv(args);
} catch (error) {
  console.error(`start:local: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
// Port 3400 by default: 3000 and 3100 are often held by other local projects.
// TRUST_PROXY_HEADERS is now an env-schema key (so it would be blanked); the smoke harness sets it
// on purpose, so it is kept whenever the caller provides it.
const keep = [
  ...(args.useTestDatabase ? ["DATABASE_URL"] : []),
  ...(process.env.TRUST_PROXY_HEADERS ? ["TRUST_PROXY_HEADERS"] : []),
  // The smoke harness opts into the local Google mock (an env-schema key, so it would be blanked).
  ...(process.env.OAUTH_FORCE_MOCK ? ["OAUTH_FORCE_MOCK"] : []),
];
const env = sanitizedChildEnv({ keep });
env.PORT = env.PORT || "3400";
const result = spawnSync(process.execPath, ["./node_modules/next/dist/bin/next", "start"], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
