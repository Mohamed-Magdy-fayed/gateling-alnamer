import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertLocalDatabase, loadLocalEnv } from "./local-env.mjs";

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

  it("skips the database guard when asked", () => {
    writeFileSync(path.join(dir, ".env"), "FOO=bar\n");
    const target = {};
    loadLocalEnv({ cwd: dir, env: target, requireLocalDatabase: false });
    expect(target.FOO).toBe("bar");
  });
});
