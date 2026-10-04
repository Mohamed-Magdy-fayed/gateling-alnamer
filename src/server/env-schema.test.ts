import { describe, expect, it } from "vitest";
import { describeProviders, EnvError, parseServerEnv } from "./env-schema";

/** Live is refused until two-factor is enforced (A7b); tests that are not about that pass it as on. */
const ENFORCED = { twoFactorEnforced: true };
const parse = (source: Record<string, string | undefined>, options = ENFORCED) =>
  parseServerEnv(source, options);

const local = { APP_MODE: "demo", DATABASE_URL: "postgres://u:p@localhost:5432/db" };

function failure(
  source: Record<string, string | undefined>,
  options: { twoFactorEnforced: boolean } = ENFORCED,
): string {
  try {
    parse(source, options);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as Error).message;
  }
  throw new Error("expected parseServerEnv to throw");
}

describe("parseServerEnv", () => {
  it("passes a minimal local demo environment", () => {
    const env = parse(local);
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
    expect(() => parse({ ...local, MYFATOORAH_API_KEY: "test-key" })).not.toThrow();
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
    const env = parse({
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
    expect(() => parse({ ...local, INNGEST_DEV: "1" })).not.toThrow();
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
      AUTH_SECRET: "d".repeat(40),
      CAPTCHA: "turnstile",
      TURNSTILE_SITE_KEY: "site-key-value",
      TURNSTILE_SECRET_KEY: "turnstile-secret-value",
      UPSTASH_REDIS_REST_URL: "https://redis.example",
      UPSTASH_REDIS_REST_TOKEN: "redis-token-value",
      TRUST_PROXY_HEADERS: "false",
    };

    it("resolves the minimal local demo to mock providers, mailpit and inline jobs", () => {
      expect(parse(local).providers).toEqual({
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
      expect(parse(local).providers.captcha).toBe("fake");
      expect(parse({ ...local, CAPTCHA: "fake" }).providers.captcha).toBe("fake");
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
      const env = parse({
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
      const { providers } = parse({ ...local, SMTP_HOST: "smtp.example" });
      expect(providers.email).toBe("smtp");
      expect(providers.emailIsDefault).toBe(true);
    });

    it("defaults demo jobs to inngest when Inngest keys are set, inngest-dev when INNGEST_DEV is", () => {
      const keys = { INNGEST_EVENT_KEY: "a", INNGEST_SIGNING_KEY: "b" };
      expect(parse({ ...local, ...keys }).providers.jobs).toBe("inngest");
      expect(parse({ ...local, INNGEST_DEV: "1" }).providers.jobs).toBe("inngest-dev");
    });

    it("honours explicit selectors in demo", () => {
      const { providers } = parse({
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
      expect(() => parse(local)).not.toThrow();
    });

    it("passes a complete live environment", () => {
      const { providers } = parse(live);
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

    it("fails live without AUTH_SECRET, naming the key only", () => {
      expect(failure({ ...live, AUTH_SECRET: undefined })).toContain("AUTH_SECRET");
    });

    it("fails on Vercel without AUTH_SECRET even in demo", () => {
      expect(failure({ ...local, VERCEL: "1" })).toContain("AUTH_SECRET");
      expect(() => parse({ ...local, VERCEL: "1", AUTH_SECRET: "a".repeat(40) })).not.toThrow();
    });

    it("fails when AUTH_SECRET is shorter than 32 characters, without echoing it", () => {
      const message = failure({ ...live, AUTH_SECRET: "short-secret-value" });
      expect(message).toContain("AUTH_SECRET");
      expect(message).not.toContain("short-secret-value");
    });

    it("leaves AUTH_SECRET optional in demo off Vercel; DEVICE_COOKIE_SECRET no longer counts", () => {
      expect(() => parse(local)).not.toThrow();
      const legacy = { ...live, AUTH_SECRET: undefined, DEVICE_COOKIE_SECRET: "d".repeat(40) };
      expect(failure(legacy)).toContain("AUTH_SECRET");
    });

    it("leaves INNGEST_ENCRYPTION_KEY optional in demo", () => {
      expect(() => parse(local)).not.toThrow();
    });

    it("refuses to boot live while two-factor is not enforced; demo is unaffected", () => {
      const off = { twoFactorEnforced: false };
      expect(failure(live, off)).toContain("APP_MODE=live requires two-factor enforcement (A7b)");
      expect(() => parse(live, off)).toThrow(EnvError);
      expect(() => parse(local, off)).not.toThrow();
      expect(() => parse(live, ENFORCED)).not.toThrow();
    });

    it("refuses INNGEST_DEV in live, on any host", () => {
      expect(failure({ ...live, INNGEST_DEV: "1" })).toContain("INNGEST_DEV");
    });

    describe("TRUST_PROXY_HEADERS", () => {
      it("parses to a boolean", () => {
        expect(parse({ ...local, TRUST_PROXY_HEADERS: "1" }).TRUST_PROXY_HEADERS).toBe(true);
        expect(parse({ ...local, TRUST_PROXY_HEADERS: "true" }).TRUST_PROXY_HEADERS).toBe(true);
        expect(parse({ ...local, TRUST_PROXY_HEADERS: "false" }).TRUST_PROXY_HEADERS).toBe(false);
        expect(parse({ ...local, TRUST_PROXY_HEADERS: "0" }).TRUST_PROXY_HEADERS).toBe(false);
        expect(parse(local).TRUST_PROXY_HEADERS).toBeUndefined();
      });

      it("rejects anything else", () => {
        expect(failure({ ...local, TRUST_PROXY_HEADERS: "maybe" })).toContain(
          "TRUST_PROXY_HEADERS",
        );
      });

      it("must be set explicitly in live off Vercel, either way", () => {
        expect(failure({ ...live, TRUST_PROXY_HEADERS: undefined })).toContain(
          "TRUST_PROXY_HEADERS",
        );
        expect(() => parse({ ...live, TRUST_PROXY_HEADERS: "true" })).not.toThrow();
        expect(() => parse({ ...live, TRUST_PROXY_HEADERS: "false" })).not.toThrow();
      });

      it("is not required in live on Vercel, nor in demo", () => {
        expect(() => parse({ ...live, VERCEL: "1", TRUST_PROXY_HEADERS: undefined })).not.toThrow();
        expect(() => parse(local)).not.toThrow();
      });
    });
  });

  describe("describeProviders", () => {
    it("lists the resolved choices without any credential value", () => {
      const line = describeProviders(
        parse({ ...local, SMTP_HOST: "smtp.example", SMTP_PASSWORD: "pw-value" }),
      );
      expect(line).toBe(
        "APP_MODE=demo payment=mock video=mock storage=local email=smtp jobs=inline",
      );
    });
  });

  it("treats blank values as unset", () => {
    expect(failure({ ...local, APP_MODE: "" })).toContain("APP_MODE");
    expect(() => parse({ ...local, BUNNY_STREAM_API_KEY: "  " })).not.toThrow();
  });
});

describe("Google sign-in keys", () => {
  it("are optional, but go together", () => {
    expect(() => parse(local)).not.toThrow();
    expect(() =>
      parse({ ...local, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }),
    ).not.toThrow();
    expect(failure({ ...local, GOOGLE_CLIENT_ID: "id" })).toMatch(
      /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together/,
    );
  });
});
