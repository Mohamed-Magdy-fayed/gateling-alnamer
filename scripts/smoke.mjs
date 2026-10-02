// `npm run smoke`: the smoke e2e on the throwaway test database (see docker-compose.yml `db-test`).
// Checks the services, migrates, builds unless `.next/BUILD_ID` is newer than every file under
// `src/` (or `--no-build` is passed), then runs Playwright.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { DEFAULT_TEST_DATABASE_URL, loadLocalEnv } from "./lib/local-env.mjs";

const MAILPIT_API = process.env.MAILPIT_URL ?? "http://localhost:8025";
const START_HINT = "Start Docker, then run `npm run db:up`.";

function fail(message) {
  console.error(`smoke: ${message}`);
  process.exit(1);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 2000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    for (const event of ["error", "timeout"]) {
      socket.once(event, () => {
        socket.destroy();
        resolve(false);
      });
    }
  });
}

async function checkServices() {
  const testDb = new URL(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
  if (!(await canConnect(testDb.hostname, Number(testDb.port || 5432)))) {
    fail(`the test database (db-test, port ${testDb.port}) is not reachable. ${START_HINT}`);
  }
  const mailpit = await fetch(`${MAILPIT_API}/api/v1/info`).catch(() => null);
  if (!mailpit?.ok) fail(`Mailpit (${MAILPIT_API}) is not reachable. ${START_HINT}`);
}

function run(args, label) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? "signal"}).`);
}

function newestSourceTime(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((newest, entry) => {
    const full = path.join(dir, entry.name);
    const time = entry.isDirectory() ? newestSourceTime(full) : statSync(full).mtimeMs;
    return Math.max(newest, time);
  }, 0);
}

function buildIsStale() {
  try {
    return statSync(".next/BUILD_ID").mtimeMs <= newestSourceTime("src");
  } catch {
    return true;
  }
}

// .env wins over anything inherited from the shell; the database guard is applied by --test-db.
try {
  loadLocalEnv({ requireLocalDatabase: false });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
await checkServices();
run(["node_modules/tsx/dist/cli.mjs", "scripts/migrate.mts", "--test-db"], "db:migrate");
if (!process.argv.includes("--no-build") && buildIsStale())
  run(["scripts/build-local.mjs", "--test-db"], "build:local");
// Screenshot baselines are recorded on the Windows dev machine; font rendering differs on
// Linux CI, so CI runs the functional smoke only (SMOKE_SKIP_VISUAL=1).
const playwrightArgs = ["node_modules/@playwright/test/cli.js", "test"];
if (process.env.SMOKE_SKIP_VISUAL === "1") playwrightArgs.push("--grep-invert", "@visual");
run(playwrightArgs, "the smoke spec");
console.log("smoke: OK");
