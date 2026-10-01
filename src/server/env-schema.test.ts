import { describe, expect, it } from "vitest";
import { EnvError, parseServerEnv } from "./env-schema";

const local = { APP_MODE: "demo", DATABASE_URL: "postgres://u:p@localhost:5432/db" };

function failure(source: Record<string, string | undefined>): string {
  try {
    parseServerEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as Error).message;
  }
  throw new Error("expected parseServerEnv to throw");
}

describe("parseServerEnv", () => {
  it("passes a minimal local demo environment", () => {
    const env = parseServerEnv(local);
    expect(env.APP_MODE).toBe("demo");
  });

  it("fails when APP_MODE is unset", () => {
    expect(failure({ DATABASE_URL: local.DATABASE_URL })).toContain("APP_MODE");
  });

  it("fails when APP_MODE is not demo or live", () => {
    expect(failure({ ...local, APP_MODE: "staging" })).toContain("APP_MODE");
  });

  it("fails when DATABASE_URL is missing", () => {
    expect(failure({ APP_MODE: "demo" })).toContain("DATABASE_URL");
  });

  it.each([
    [
      "MYFATOORAH_LIVE=true with an API key",
      { MYFATOORAH_LIVE: "true", MYFATOORAH_API_KEY: "secret-a" },
      "MYFATOORAH_API_KEY",
    ],
    ["a Bunny Stream key", { BUNNY_STREAM_API_KEY: "secret-b" }, "BUNNY_STREAM_API_KEY"],
    [
      "a Firebase service account",
      { FIREBASE_SERVICE_ACCOUNT: "secret-c" },
      "FIREBASE_SERVICE_ACCOUNT",
    ],
  ])("fails demo with %s, naming the key and not the value", (_label, extra, key) => {
    const message = failure({ ...local, ...extra });
    expect(message).toContain(key);
    expect(message).not.toContain("secret-");
  });

  it("allows a MyFatoorah test key in demo", () => {
    expect(() => parseServerEnv({ ...local, MYFATOORAH_API_KEY: "test-key" })).not.toThrow();
  });

  it("fails demo on VERCEL_ENV=production when the BASE_URL host is not in DEMO_HOSTS", () => {
    const message = failure({
      ...local,
      VERCEL_ENV: "production",
      BASE_URL: "https://alnamer.example",
      DEMO_HOSTS: "alnamer.gateling.com",
    });
    expect(message).toContain("DEMO_HOSTS");
  });

  it("fails demo on production when DEMO_HOSTS is empty", () => {
    expect(
      failure({ ...local, VERCEL_ENV: "production", BASE_URL: "https://alnamer.gateling.com" }),
    ).toContain("DEMO_HOSTS");
  });

  it("passes demo on an allowlisted production host", () => {
    const env = parseServerEnv({
      ...local,
      VERCEL_ENV: "production",
      BASE_URL: "https://alnamer.gateling.com",
      DEMO_HOSTS: "other.example, alnamer.gateling.com",
    });
    expect(env.VERCEL_ENV).toBe("production");
  });

  it.each(["preview", "production"])("fails %s deployments without BASE_URL", (vercelEnv) => {
    expect(failure({ ...local, VERCEL_ENV: vercelEnv, DEMO_HOSTS: "x.example" })).toContain(
      "BASE_URL",
    );
  });

  it("fails when INNGEST_DEV is set together with VERCEL", () => {
    expect(failure({ ...local, INNGEST_DEV: "1", VERCEL: "1" })).toContain("INNGEST_DEV");
  });

  it("allows INNGEST_DEV locally", () => {
    expect(() => parseServerEnv({ ...local, INNGEST_DEV: "1" })).not.toThrow();
  });

  it("fails live with DEMO_ACCOUNTS_PASSWORD, without echoing it", () => {
    const message = failure({
      ...local,
      APP_MODE: "live",
      BASE_URL: "https://alnamer.example",
      DEMO_ACCOUNTS_PASSWORD: "hunter2-value",
    });
    expect(message).toContain("DEMO_ACCOUNTS_PASSWORD");
    expect(message).not.toContain("hunter2-value");
  });

  it("never includes the DATABASE_URL value in errors", () => {
    const message = failure({
      APP_MODE: "staging",
      DATABASE_URL: "postgres://user:topsecret@h/db",
    });
    expect(message).not.toContain("topsecret");
  });

  it("treats blank values as unset", () => {
    expect(failure({ ...local, APP_MODE: "" })).toContain("APP_MODE");
    expect(() => parseServerEnv({ ...local, BUNNY_STREAM_API_KEY: "  " })).not.toThrow();
  });
});
