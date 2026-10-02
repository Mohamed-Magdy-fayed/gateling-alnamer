import { describe, expect, it, vi } from "vitest";
import {
  captchaConfig,
  createCaptchaVerifier,
  FAKE_CAPTCHA_FAIL_TOKEN,
  FAKE_CAPTCHA_OK_TOKEN,
  TURNSTILE_TIMEOUT_MS,
  TURNSTILE_VERIFY_URL,
} from "./captcha";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fake provider", () => {
  const verify = createCaptchaVerifier({ provider: "fake" });

  it("accepts the widget's token and any other non-empty token", async () => {
    expect(await verify(FAKE_CAPTCHA_OK_TOKEN, "203.0.113.5")).toBe(true);
    expect(await verify("anything", "203.0.113.5")).toBe(true);
  });

  it("rejects the forced failure token, an empty token and a missing token", async () => {
    expect(FAKE_CAPTCHA_FAIL_TOKEN).toBe("fail");
    expect(await verify("fail", "203.0.113.5")).toBe(false);
    expect(await verify("", "203.0.113.5")).toBe(false);
    expect(await verify("   ", "203.0.113.5")).toBe(false);
    expect(await verify(undefined, "203.0.113.5")).toBe(false);
  });
});

describe("turnstile provider", () => {
  it("posts the secret, token and client IP to siteverify and accepts success", async () => {
    const fetcher = vi.fn(async () => json({ success: true }));
    const verify = createCaptchaVerifier({
      provider: "turnstile",
      secretKey: "secret-value",
      fetch: fetcher,
    });
    expect(await verify("token-1", "203.0.113.5")).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(TURNSTILE_VERIFY_URL).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("secret-value");
    expect(body.get("response")).toBe("token-1");
    expect(body.get("remoteip")).toBe("203.0.113.5");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects when Cloudflare says the token is not valid", async () => {
    const verify = createCaptchaVerifier({
      provider: "turnstile",
      secretKey: "s",
      fetch: async () => json({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    expect(await verify("bad", "203.0.113.5")).toBe(false);
  });

  it("rejects an empty token without calling Cloudflare", async () => {
    const fetcher = vi.fn(async () => json({ success: true }));
    const verify = createCaptchaVerifier({ provider: "turnstile", secretKey: "s", fetch: fetcher });
    expect(await verify(undefined, "203.0.113.5")).toBe(false);
    expect(await verify("", "203.0.113.5")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed on a network error, an HTTP error and a malformed answer", async () => {
    const settings = { provider: "turnstile", secretKey: "s" } as const;
    expect(
      await createCaptchaVerifier({
        ...settings,
        fetch: async () => {
          throw new Error("offline");
        },
      })("t", "ip"),
    ).toBe(false);
    expect(
      await createCaptchaVerifier({ ...settings, fetch: async () => json({ success: true }, 500) })(
        "t",
        "ip",
      ),
    ).toBe(false);
    expect(
      await createCaptchaVerifier({ ...settings, fetch: async () => json({ nope: 1 }) })("t", "ip"),
    ).toBe(false);
  });

  it("treats a timeout as a failure", async () => {
    expect(TURNSTILE_TIMEOUT_MS).toBe(5000);
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const verify = createCaptchaVerifier({
      provider: "turnstile",
      secretKey: "s",
      fetch: hanging,
      timeoutMs: 20,
    });
    expect(await verify("t", "ip")).toBe(false);
  });
});

describe("captchaConfig", () => {
  it("hands the client only the provider and the public site key", () => {
    expect(captchaConfig({ provider: "fake" })).toEqual({ provider: "fake" });
    expect(captchaConfig({ provider: "turnstile", siteKey: "site", secretKey: "secret" })).toEqual({
      provider: "turnstile",
      siteKey: "site",
    });
  });
});
