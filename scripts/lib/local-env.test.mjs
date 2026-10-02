import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertLocalDatabase,
  DEFAULT_TEST_DATABASE_URL,
  loadLocalEnv,
  parseLocalArgs,
  sanitizedChildEnv,
} from "./local-env.mjs";

const SECRET = "s3cret-pw";

describe("assertLocalDatabase", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"])("accepts %s", (host) => {
    const url = `postgres://user:${SECRET}@${host}:5432/db`;
    expect(() => assertLocalDatabase({ DATABASE_URL: url })).not.toThrow();
  });

  it("refuses a non-local host and names the key, not the value", () => {
    const url = `postgres://user:${SECRET}@db.example.com:5432/db`;
    let message = "";
    try {
      assertLocalDatabase({ DATABASE_URL: url });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("db.example.com");
  });

  it("refuses a missing DATABASE_URL", () => {
    expect(() => assertLocalDatabase({})).toThrow(/DATABASE_URL/);
    expect(() => assertLocalDatabase({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("refuses an unparseable DATABASE_URL without echoing it", () => {
    let message = "";
    try {
      assertLocalDatabase({ DATABASE_URL: `not a url ${SECRET}` });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain(SECRET);
  });
});

describe("loadLocalEnv", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "local-env-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads .env and overrides keys already in the target", () => {
    writeFileSync(
      path.join(dir, ".env"),
      "DATABASE_URL=postgres://u:p@localhost:5432/d\nFOO=from-file\n",
    );
    const target = { FOO: "from-shell", DATABASE_URL: "postgres://u:p@prod.example.com/d" };
    loadLocalEnv({ cwd: dir, env: target });
    expect(target.FOO).toBe("from-file");
    expect(target.DATABASE_URL).toContain("localhost");
  });

  it("refuses when the .env database host is not local", () => {
    writeFileSync(path.join(dir, ".env"), "DATABASE_URL=postgres://u:p@prod.example.com:5432/d\n");
    expect(() => loadLocalEnv({ cwd: dir, env: {} })).toThrow(/DATABASE_URL/);
  });

  it("refuses when .env has no DATABASE_URL", () => {
    writeFileSync(path.join(dir, ".env"), "FOO=bar\n");
    expect(() => loadLocalEnv({ cwd: dir, env: {} })).toThrow(/DATABASE_URL/);
  });

  it("uses the default test database with --test-db even when .env points at a remote one", () => {
    writeFileSync(path.join(dir, ".env"), "DATABASE_URL=postgres://u:p@prod.example.com:5432/d\n");
    const target = {};
    loadLocalEnv({ cwd: dir, env: target, useTestDatabase: true });
    expect(target.DATABASE_URL).toBe(DEFAULT_TEST_DATABASE_URL);
  });

  it("uses TEST_DATABASE_URL from .env with --test-db", () => {
    writeFileSync(
      path.join(dir, ".env"),
      "DATABASE_URL=postgres://u:p@prod.example.com/d\nTEST_DATABASE_URL=postgres://t:t@localhost:6543/t\n",
    );
    const target = {};
    loadLocalEnv({ cwd: dir, env: target, useTestDatabase: true });
    expect(target.DATABASE_URL).toBe("postgres://t:t@localhost:6543/t");
  });

  it("treats a blank TEST_DATABASE_URL as the default", () => {
    writeFileSync(path.join(dir, ".env"), "TEST_DATABASE_URL=\n");
    const target = {};
    loadLocalEnv({ cwd: dir, env: target, useTestDatabase: true });
    expect(target.DATABASE_URL).toBe(DEFAULT_TEST_DATABASE_URL);
  });

  it("refuses a remote TEST_DATABASE_URL and names that key, not the value", () => {
    writeFileSync(
      path.join(dir, ".env"),
      `TEST_DATABASE_URL=postgres://t:${SECRET}@db.example.com/t\n`,
    );
    let message = "";
    try {
      loadLocalEnv({ cwd: dir, env: {}, useTestDatabase: true });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("TEST_DATABASE_URL");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("db.example.com");
  });

  it("leaves DATABASE_URL alone without the flag", () => {
    writeFileSync(
      path.join(dir, ".env"),
      "DATABASE_URL=postgres://u:p@localhost:5432/d\nTEST_DATABASE_URL=postgres://t:t@localhost:6543/t\n",
    );
    const target = {};
    loadLocalEnv({ cwd: dir, env: target });
    expect(target.DATABASE_URL).toBe("postgres://u:p@localhost:5432/d");
  });

  it("skips the database guard when asked", () => {
    writeFileSync(path.join(dir, ".env"), "FOO=bar\n");
    const target = {};
    loadLocalEnv({ cwd: dir, env: target, requireLocalDatabase: false });
    expect(target.FOO).toBe("bar");
  });
});

describe("sanitizedChildEnv", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "child-env-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("blanks schema keys and keys named in any .env* file that .env lacks", () => {
    writeFileSync(path.join(dir, ".env"), "APP_MODE=demo\n");
    writeFileSync(path.join(dir, ".env.production.local"), "SOME_PROD_ONLY_KEY=x\nAPP_MODE=live\n");
    writeFileSync(path.join(dir, ".env.preview.local"), "ANOTHER_PREVIEW_KEY=y\n");
    const child = sanitizedChildEnv({ cwd: dir, env: { APP_MODE: "demo", PATH: "p" } });
    expect(child.SOME_PROD_ONLY_KEY).toBe("");
    expect(child.ANOTHER_PREVIEW_KEY).toBe("");
    expect(child.MYFATOORAH_API_KEY).toBe("");
    expect(child.DATABASE_URL).toBe("");
    expect(child.APP_MODE).toBe("demo");
    expect(child.PATH).toBe("p");
  });

  it("keeps keys that .env defines and does not mutate the input", () => {
    writeFileSync(path.join(dir, ".env"), "SMTP_HOST=localhost\n");
    writeFileSync(path.join(dir, ".env.production.local"), "SMTP_HOST=prod\n");
    const source = { SMTP_HOST: "localhost" };
    const child = sanitizedChildEnv({ cwd: dir, env: source });
    expect(child.SMTP_HOST).toBe("localhost");
    expect(child).not.toBe(source);
    expect(source).not.toHaveProperty("SMTP_PASSWORD");
  });
});

describe("parseLocalArgs", () => {
  it("detects --test-db", () => {
    expect(parseLocalArgs(["--test-db"])).toEqual({ useTestDatabase: true });
    expect(parseLocalArgs(["--other", "--test-db"])).toEqual({ useTestDatabase: true });
  });

  it("defaults to false", () => {
    expect(parseLocalArgs([])).toEqual({ useTestDatabase: false });
  });
});

describe("migrate.mts guard", () => {
  it("refuses a remote DATABASE_URL before connecting", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "migrate-guard-"));
    try {
      writeFileSync(
        path.join(dir, ".env"),
        `DATABASE_URL=postgres://u:${SECRET}@db.example.com/x\n`,
      );
      const root = process.cwd();
      const env = { ...process.env };
      delete env.VERCEL;
      delete env.DATABASE_URL;
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
          path.join(root, "scripts", "migrate.mts"),
        ],
        { cwd: dir, env, encoding: "utf8", timeout: 30000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("DATABASE_URL");
      expect(result.stderr).not.toContain(SECRET);
      expect(result.stdout).not.toContain("Migrations applied");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
