import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SECRET = "s3cret-pw";
const root = process.cwd();

function runSeed(env, cwd) {
  return spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
      "--conditions=react-server",
      path.join(root, "scripts", "seed.mts"),
    ],
    { cwd, env, encoding: "utf8", timeout: 30000 },
  );
}

describe("seed.mts guards", () => {
  it("refuses when VERCEL is set", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "seed-vercel-"));
    try {
      writeFileSync(path.join(dir, ".env"), "DATABASE_URL=postgres://u:p@localhost/x\n");
      const result = runSeed({ ...process.env, VERCEL: "1" }, dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("VERCEL");
      expect(result.stdout).not.toContain("Seeded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a remote DATABASE_URL before connecting", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "seed-guard-"));
    try {
      writeFileSync(
        path.join(dir, ".env"),
        `DATABASE_URL=postgres://u:${SECRET}@db.example.com/x\n`,
      );
      const env = { ...process.env };
      delete env.VERCEL;
      delete env.DATABASE_URL;
      const result = runSeed(env, dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("DATABASE_URL");
      expect(result.stderr).not.toContain(SECRET);
      expect(result.stdout).not.toContain("Seeded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
