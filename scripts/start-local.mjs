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
const env = sanitizedChildEnv({ keep: args.useTestDatabase ? ["DATABASE_URL"] : [] });
env.PORT = env.PORT || "3400";
const result = spawnSync(process.execPath, ["./node_modules/next/dist/bin/next", "start"], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
