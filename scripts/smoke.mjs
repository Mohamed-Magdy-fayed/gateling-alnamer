// `npm run smoke`: the smoke e2e on the throwaway test database (see docker-compose.yml `db-test`).
// Checks the services, migrates, builds when `.next` is older than HEAD, then runs Playwright.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import net from "node:net";
import { DEFAULT_TEST_DATABASE_URL } from "./lib/local-env.mjs";

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

function headTime() {
  const git = spawnSync("git", ["log", "-1", "--format=%ct"], { encoding: "utf8" });
  return git.status === 0 ? Number(git.stdout.trim()) * 1000 : Number.POSITIVE_INFINITY;
}

function buildIsStale() {
  try {
    return statSync(".next/BUILD_ID").mtimeMs < headTime();
  } catch {
    return true;
  }
}

await checkServices();
run(["node_modules/tsx/dist/cli.mjs", "scripts/migrate.mts", "--test-db"], "db:migrate");
if (buildIsStale()) run(["scripts/build-local.mjs", "--test-db"], "build:local");
run(["node_modules/@playwright/test/cli.js", "test"], "the smoke spec");
console.log("smoke: OK");
