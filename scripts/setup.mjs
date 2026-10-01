// Usage: npm run setup [-- --test-db]. env:init, then Docker services, migrations and seed.
// `--test-db` is passed to migrate and seed so they target the throwaway db-test container.
import { spawnSync } from "node:child_process";

const passthrough = process.argv.slice(2).filter((arg) => arg === "--test-db");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  ["env:init", [npm, "run", "env:init"]],
  ["docker compose up", ["docker", "compose", "up", "-d", "--wait"]],
  ["db:migrate", [npm, "run", "db:migrate", ...(passthrough.length ? ["--", ...passthrough] : [])]],
  ["db:seed", [npm, "run", "db:seed", ...(passthrough.length ? ["--", ...passthrough] : [])]],
];

for (const [label, [command, ...args]] of steps) {
  console.log(`\n> setup: ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\nsetup stopped at "${label}".`);
    process.exit(result.status ?? 1);
  }
}
console.log("\nsetup complete. Start the app with: npm run dev");
