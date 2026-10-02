// `next start` with `.env` forced and a local-database guard (see lib/local-env.mjs).
import { spawnSync } from "node:child_process";
import { loadLocalEnv, parseLocalArgs, sanitizedChildEnv } from "./lib/local-env.mjs";

try {
  loadLocalEnv(parseLocalArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`start:local: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
const result = spawnSync(process.execPath, ["./node_modules/next/dist/bin/next", "start"], {
  stdio: "inherit",
  env: sanitizedChildEnv(),
});
process.exit(result.status ?? 1);
