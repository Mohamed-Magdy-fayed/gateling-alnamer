import { describe, expect, it } from "vitest";
import { describeProviders, EnvError, parseServerEnv } from "./env-schema";

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

  describe("provider selectors", () => {
    const live = {
      APP_MODE: "live",
      DATABASE_URL: local.DATABASE_URL,
      BASE_URL: "https://alnamer.example",
      PAYMENT_PROVIDER: "myfatoorah",
      VIDEO_PROVIDER: "bunny",
      STORAGE_DRIVER: "firebase",
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.example",
      JOBS_MODE: "inngest",
      INNGEST_EVENT_KEY: "event-key-value",
      INNGEST_SIGNING_KEY: "signing-key-value",
      INNGEST_ENCRYPTION_KEY: "encryption-key-value",
      DEVICE_COOKIE_SECRET: "d".repeat(40),
      CAPTCHA: "turnstile",
      TURNSTILE_SITE_KEY: "site-key-value",
      TURNSTILE_SECRET_KEY: "turnstile-secret-value",
      UPSTASH_REDIS_REST_URL: "https://redis.example",
      UPSTASH_REDIS_REST_TOKEN: "redis-token-value",
    };

    it("resolves the minimal local demo to mock providers, mailpit and inline jobs", () => {
      expect(parseServerEnv(local).providers).toEqual({
        payment: "mock",
        video: "mock",
        storage: "local",
        email: "mailpit",
        emailIsDefault: true,
        jobs: "inline",
        captcha: "fake",
      });
    });

    it("defaults demo CAPTCHA to fake and honours an explicit fake", () => {
      expect(parseServerEnv(local).providers.captcha).toBe("fake");
      expect(parseServerEnv({ ...local, CAPTCHA: "fake" }).providers.captcha).toBe("fake");
    });

    it("refuses CAPTCHA=fake in live, naming the key", () => {
      expect(failure({ ...live, CAPTCHA: "fake" })).toContain("CAPTCHA");
    });

    it("requires CAPTCHA to be set explicitly in live", () => {
      expect(failure({ ...live, CAPTCHA: undefined })).toContain("CAPTCHA");
    });

    it("requires both Turnstile keys when CAPTCHA=turnstile, without echoing the other key", () => {
      const demo = { ...local, CAPTCHA: "turnstile" };
      expect(failure(demo)).toContain("TURNSTILE_SITE_KEY");
      expect(failure(demo)).toContain("TURNSTILE_SECRET_KEY");
      const message = failure({ ...demo, TURNSTILE_SITE_KEY: "site-key-value" });
      expect(message).toContain("TURNSTILE_SECRET_KEY");
      expect(message).not.toContain("site-key-value");
      expect(failure({ ...live, TURNSTILE_SECRET_KEY: undefined })).toContain(
        "TURNSTILE_SECRET_KEY",
      );
    });

    it("passes CAPTCHA=turnstile with both keys", () => {
      const env = parseServerEnv({
        ...local,
        CAPTCHA: "turnstile",
        TURNSTILE_SITE_KEY: "site",
        TURNSTILE_SECRET_KEY: "secret",
      });
      expect(env.providers.captcha).toBe("turnstile");
    });

    it("fails an unknown CAPTCHA value, naming the key", () => {
      expect(failure({ ...local, CAPTCHA: "recaptcha" })).toContain("CAPTCHA");
    });

    it("defaults demo email to smtp when SMTP_HOST is set", () => {
      const { providers } = parseServerEnv({ ...local, SMTP_HOST: "smtp.example" });
      expect(providers.email).toBe("smtp");
      expect(providers.emailIsDefault).toBe(true);
    });

    it("defaults demo jobs to inngest when Inngest keys are set, inngest-dev when INNGEST_DEV is", () => {
      const keys = { INNGEST_EVENT_KEY: "a", INNGEST_SIGNING_KEY: "b" };
      expect(parseServerEnv({ ...local, ...keys }).providers.jobs).toBe("inngest");
      expect(parseServerEnv({ ...local, INNGEST_DEV: "1" }).providers.jobs).toBe("inngest-dev");
    });

    it("honours explicit selectors in demo", () => {
      const { providers } = parseServerEnv({
        ...local,
        EMAIL_TRANSPORT: "mailpit",
        STORAGE_DRIVER: "local",
        VIDEO_PROVIDER: "sample",
      });
      expect(providers.email).toBe("mailpit");
      expect(providers.emailIsDefault).toBe(false);
      expect(providers.video).toBe("sample");
    });

    it("fails an unknown selector value, naming the key", () => {
      const message = failure({ ...local, PAYMENT_PROVIDER: "stripe" });
      expect(message).toContain("PAYMENT_PROVIDER");
      expect(message).not.toContain("stripe");
    });

    it("fails EMAIL_TRANSPORT=smtp without SMTP_HOST", () => {
      expect(failure({ ...local, EMAIL_TRANSPORT: "smtp" })).toContain("SMTP_HOST");
    });

    it("fails JOBS_MODE=inngest without Inngest keys", () => {
      expect(failure({ ...local, JOBS_MODE: "inngest" })).toContain("INNGEST_EVENT_KEY");
    });

    it.each(["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"])(
      "fails live without %s, naming the key and not the other value",
      (key) => {
        const message = failure({ ...live, [key]: undefined });
        expect(message).toContain(key);
        expect(message).not.toContain("redis-token-value");
      },
    );

    it("treats the Upstash keys as optional in demo", () => {
      expect(() => parseServerEnv(local)).not.toThrow();
    });

    it("passes a complete live environment", () => {
      const { providers } = parseServerEnv(live);
      expect(providers).toMatchObject({ payment: "myfatoorah", jobs: "inngest", email: "smtp" });
    });

    it.each([
      ["PAYMENT_PROVIDER", "mock"],
      ["VIDEO_PROVIDER", "mock"],
      ["VIDEO_PROVIDER", "sample"],
      ["STORAGE_DRIVER", "local"],
      ["EMAIL_TRANSPORT", "mailpit"],
      ["JOBS_MODE", "inline"],
      ["JOBS_MODE", "inngest-dev"],
    ])("fails live with %s=%s", (key, value) => {
      expect(failure({ ...live, [key]: value })).toContain(key);
    });

    it.each([
      "PAYMENT_PROVIDER",
      "VIDEO_PROVIDER",
      "STORAGE_DRIVER",
      "EMAIL_TRANSPORT",
      "JOBS_MODE",
    ])("fails live when %s is not explicit", (key) => {
      expect(failure({ ...live, [key]: undefined })).toContain(key);
    });

    it("fails live without Inngest keys, without echoing the other key", () => {
      const message = failure({ ...live, INNGEST_EVENT_KEY: undefined });
      expect(message).toContain("INNGEST_EVENT_KEY");
      expect(message).not.toContain("signing-key-value");
    });

    it("fails live without INNGEST_ENCRYPTION_KEY, naming the key only", () => {
      const message = failure({ ...live, INNGEST_ENCRYPTION_KEY: undefined });
      expect(message).toContain("INNGEST_ENCRYPTION_KEY");
      expect(message).not.toContain("signing-key-value");
    });

    it("fails live without DEVICE_COOKIE_SECRET, naming the key only", () => {
      expect(failure({ ...live, DEVICE_COOKIE_SECRET: undefined })).toContain(
        "DEVICE_COOKIE_SECRET",
      );
    });

    it("fails when DEVICE_COOKIE_SECRET is shorter than 32 characters, without echoing it", () => {
      const message = failure({ ...live, DEVICE_COOKIE_SECRET: "short-secret-value" });
      expect(message).toContain("DEVICE_COOKIE_SECRET");
      expect(message).not.toContain("short-secret-value");
    });

    it("leaves DEVICE_COOKIE_SECRET optional in demo", () => {
      expect(() => parseServerEnv(local)).not.toThrow();
    });

    it("leaves INNGEST_ENCRYPTION_KEY optional in demo", () => {
      expect(() => parseServerEnv(local)).not.toThrow();
    });
  });

  describe("describeProviders", () => {
    it("lists the resolved choices without any credential value", () => {
      const line = describeProviders(
        parseServerEnv({ ...local, SMTP_HOST: "smtp.example", SMTP_PASSWORD: "pw-value" }),
      );
      expect(line).toBe(
        "APP_MODE=demo payment=mock video=mock storage=local email=smtp jobs=inline",
      );
    });
  });

  it("treats blank values as unset", () => {
    expect(failure({ ...local, APP_MODE: "" })).toContain("APP_MODE");
    expect(() => parseServerEnv({ ...local, BUNNY_STREAM_API_KEY: "  " })).not.toThrow();
  });
});
