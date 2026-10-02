import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const PASSWORD = "demo-pw-not-printed";

function run(extra) {
  const env = { ...process.env, DATABASE_URL: "postgres://u:p@127.0.0.1:1/x" };
  delete env.APP_MODE;
  delete env.DEMO_ACCOUNTS_PASSWORD;
  return spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
      "--conditions=react-server",
      path.join(root, "scripts", "seed-demo.mts"),
    ],
    { cwd: root, env: { ...env, ...extra }, encoding: "utf8", timeout: 30000 },
  );
}

describe("seed-demo.mts guards", () => {
  it("does nothing and exits 0 without the password", () => {
    const result = run({ APP_MODE: "demo" });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Seeded");
  });

  it("does nothing when APP_MODE is not demo", () => {
    expect(run({ DEMO_ACCOUNTS_PASSWORD: PASSWORD }).status).toBe(0);
  });

  it("refuses APP_MODE=live with the password set, without echoing it", () => {
    const result = run({ APP_MODE: "live", DEMO_ACCOUNTS_PASSWORD: PASSWORD });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("APP_MODE=live");
    expect(result.stderr).not.toContain(PASSWORD);
    expect(result.stdout).not.toContain(PASSWORD);
  });

  it("never creates a super admin and resets sessions (static check)", () => {
    const source = readFileSync(path.join(root, "scripts", "seed-demo.mts"), "utf8");
    expect(source).not.toMatch(/isSuperAdmin:\s*true/);
    expect(source).toContain("deleteUserSessions");
    expect(source).toContain("isSample: true");
  });
});
