// `next build` with `.env` forced first. A production build otherwise auto-loads
// `.env.production.local`, which holds real Production credentials, and Next never
// overrides keys that are already in process.env.
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env", override: true });
const result = spawnSync(process.execPath, ["./node_modules/next/dist/bin/next", "build"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
