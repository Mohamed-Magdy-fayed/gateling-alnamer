// `next build` with `.env` forced first (see lib/local-env.mjs).
import { spawnSync } from "node:child_process";
import { loadLocalEnv, parseLocalArgs } from "./lib/local-env.mjs";

try {
  loadLocalEnv(parseLocalArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`build:local: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
const result = spawnSync(process.execPath, ["./node_modules/next/dist/bin/next", "build"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
