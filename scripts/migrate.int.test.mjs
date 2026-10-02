import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/int/db-url";

// `migrate.mts --test-db` targets TEST_DATABASE_URL itself, so this file owns that database's
// schemas. The template and worker databases are separate and unaffected.
const adminUrl = testDatabaseUrl();
const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
const journal = JSON.parse(readFileSync("src/server/db/migrations/meta/_journal.json", "utf8"));
const migrationCount = journal.entries.length;

function runMigrate() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/migrate.mts", "--test-db"], {
      env: { ...process.env, TEST_DATABASE_URL: adminUrl },
      stdio: "pipe",
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

async function appliedCount() {
  const [row] = await sql`select count(*)::int as n from drizzle.__alnamer_migrations`;
  return row.n;
}

describe("scripts/migrate.mts", () => {
  beforeEach(async () => {
    await sql.unsafe("drop schema if exists drizzle cascade");
    await sql.unsafe("drop schema if exists public cascade");
    await sql.unsafe("create schema public");
  });

  afterAll(async () => {
    await sql.end();
  });

  it("is a no-op the second time", async () => {
    expect((await runMigrate()).code).toBe(0);
    expect(await appliedCount()).toBe(migrationCount);
    expect((await runMigrate()).code).toBe(0);
    expect(await appliedCount()).toBe(migrationCount);
  });

  it("applies each migration once when two runs race", async () => {
    const results = await Promise.all([runMigrate(), runMigrate()]);
    for (const result of results) expect(result.code, result.output).toBe(0);
    expect(await appliedCount()).toBe(migrationCount);
  });
});
