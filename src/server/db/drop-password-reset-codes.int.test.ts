import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });

afterAll(async () => {
  await client.end();
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "migrations" || name === "node_modules" || name === ".next") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mts|mjs|js)$/.test(name) ? [full] : [];
  });
}

describe("password_reset_codes contract", () => {
  it("is dropped by the migrations", async () => {
    const rows = await client`SELECT to_regclass('public.password_reset_codes') AS t`;
    expect(rows[0]?.t).toBeNull();
  });

  it("is not referenced in src/ or scripts/ outside migrations", () => {
    const self = path.resolve(__filename);
    const offenders = ["src", "scripts"]
      .flatMap((d) => sourceFiles(path.join(process.cwd(), d)))
      .filter((f) => path.resolve(f) !== self)
      .filter((f) => /passwordResetCodes|password_reset_codes/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
