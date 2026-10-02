import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "dotenv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts", "env-init.mjs");
const GENERATED = [
  "IBAN_ENCRYPTION_KEY",
  "TOTP_ENCRYPTION_KEY",
  "DEVICE_COOKIE_SECRET",
  "LOCAL_REDIS_TOKEN",
];

function runInit(cwd) {
  return spawnSync(process.execPath, [script], { cwd, encoding: "utf8", timeout: 30000 });
}

describe("env:init", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "env-init-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates .env with generated 32-byte base64 secrets, different each run", () => {
    const secondDir = mkdtempSync(path.join(tmpdir(), "env-init-"));
    try {
      expect(runInit(dir).status).toBe(0);
      expect(runInit(secondDir).status).toBe(0);
      const first = parse(readFileSync(path.join(dir, ".env"), "utf8"));
      const second = parse(readFileSync(path.join(secondDir, ".env"), "utf8"));
      for (const key of GENERATED) {
        expect(Buffer.from(first[key], "base64")).toHaveLength(32);
        expect(first[key]).not.toBe(second[key]);
      }
    } finally {
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("writes working local defaults", () => {
    runInit(dir);
    const values = parse(readFileSync(path.join(dir, ".env"), "utf8"));
    expect(values.APP_MODE).toBe("demo");
    expect(values.DATABASE_URL).toContain("localhost");
    expect(values.UPSTASH_REDIS_REST_TOKEN).toBe(values.LOCAL_REDIS_TOKEN);
  });

  it("appends only missing keys, keeps existing values and prints names only", () => {
    writeFileSync(path.join(dir, ".env"), "APP_MODE=demo\nIBAN_ENCRYPTION_KEY=keep-me-secret\n");
    const result = runInit(dir);
    expect(result.status).toBe(0);
    const values = parse(readFileSync(path.join(dir, ".env"), "utf8"));
    expect(values.IBAN_ENCRYPTION_KEY).toBe("keep-me-secret");
    expect(Buffer.from(values.TOTP_ENCRYPTION_KEY, "base64")).toHaveLength(32);
    expect(result.stdout).toContain("TOTP_ENCRYPTION_KEY");
    expect(result.stdout).not.toContain("keep-me-secret");
    expect(result.stdout).not.toContain(values.TOTP_ENCRYPTION_KEY);
  });

  it("treats a blank generated key as missing and fills it in place", () => {
    writeFileSync(path.join(dir, ".env"), "APP_MODE=demo\nIBAN_ENCRYPTION_KEY=\n");
    runInit(dir);
    const text = readFileSync(path.join(dir, ".env"), "utf8");
    const values = parse(text);
    expect(Buffer.from(values.IBAN_ENCRYPTION_KEY, "base64")).toHaveLength(32);
    expect(text.match(/^IBAN_ENCRYPTION_KEY=/gm)).toHaveLength(1);
  });

  it("reuses an existing LOCAL_REDIS_TOKEN for UPSTASH_REDIS_REST_TOKEN", () => {
    writeFileSync(path.join(dir, ".env"), "LOCAL_REDIS_TOKEN=shared-token\n");
    runInit(dir);
    const values = parse(readFileSync(path.join(dir, ".env"), "utf8"));
    expect(values.LOCAL_REDIS_TOKEN).toBe("shared-token");
    expect(values.UPSTASH_REDIS_REST_TOKEN).toBe("shared-token");
  });

  it("reuses an existing UPSTASH_REDIS_REST_TOKEN for LOCAL_REDIS_TOKEN", () => {
    writeFileSync(path.join(dir, ".env"), "UPSTASH_REDIS_REST_TOKEN=shared-token\n");
    runInit(dir);
    const values = parse(readFileSync(path.join(dir, ".env"), "utf8"));
    expect(values.UPSTASH_REDIS_REST_TOKEN).toBe("shared-token");
    expect(values.LOCAL_REDIS_TOKEN).toBe("shared-token");
  });
});
