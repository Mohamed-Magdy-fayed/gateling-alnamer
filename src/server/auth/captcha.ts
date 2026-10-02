import { z } from "zod";
import { serverEnv } from "@/server/env";

/** Resolves true when the challenge `token` proves a human. Any provider failure resolves false. */
export type CaptchaVerifier = (token: string | undefined, ip: string) => Promise<boolean>;

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_TIMEOUT_MS = 5000;
/** What the fake widget submits; the fake provider accepts any non-empty token except the fail token. */
export const FAKE_CAPTCHA_OK_TOKEN = "fake-ok";
/** Forces a failure with the fake provider (tests); the turnstile provider has no such token. */
export const FAKE_CAPTCHA_FAIL_TOKEN = "fail";

export type CaptchaSettings =
  | { readonly provider: "fake" }
  | {
      readonly provider: "turnstile";
      readonly secretKey: string;
      /** Injectable for tests. */
      readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
      readonly timeoutMs?: number;
    };

/** What the browser needs: the provider and, for Turnstile, the public site key. Never the secret. */
export type CaptchaConfig =
  | { readonly provider: "fake" }
  | { readonly provider: "turnstile"; readonly siteKey: string };

const siteverifyAnswer = z.object({ success: z.boolean() });

async function verifyWithTurnstile(
  settings: Extract<CaptchaSettings, { provider: "turnstile" }>,
  token: string,
  ip: string,
): Promise<boolean> {
  const send = settings.fetch ?? fetch;
  try {
    const response = await send(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret: settings.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(settings.timeoutMs ?? TURNSTILE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const answer = siteverifyAnswer.safeParse(await response.json());
    return answer.success && answer.data.success;
  } catch {
    // Network error, timeout or malformed body: a challenge that cannot be checked is not passed.
    return false;
  }
}

export function createCaptchaVerifier(settings: CaptchaSettings): CaptchaVerifier {
  return async (token, ip) => {
    const value = token?.trim();
    if (!value) return false;
    if (settings.provider === "fake") return value !== FAKE_CAPTCHA_FAIL_TOKEN;
    return verifyWithTurnstile(settings, value, ip);
  };
}

/** Provider settings from the validated environment (env-schema guarantees the keys are present). */
function settingsFromEnv(): CaptchaSettings {
  const env = serverEnv();
  if (env.providers.captcha === "turnstile" && env.TURNSTILE_SECRET_KEY) {
    return { provider: "turnstile", secretKey: env.TURNSTILE_SECRET_KEY };
  }
  return { provider: "fake" };
}

export const verifyCaptcha: CaptchaVerifier = (token, ip) =>
  createCaptchaVerifier(settingsFromEnv())(token, ip);

export function captchaConfig(
  keys: { provider: "fake" } | { provider: "turnstile"; siteKey: string; secretKey: string },
): CaptchaConfig {
  return keys.provider === "turnstile"
    ? { provider: "turnstile", siteKey: keys.siteKey }
    : { provider: "fake" };
}

/** The config the auth pages hand to the forms. */
export function currentCaptchaConfig(): CaptchaConfig {
  const env = serverEnv();
  if (env.providers.captcha === "turnstile" && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) {
    return captchaConfig({
      provider: "turnstile",
      siteKey: env.TURNSTILE_SITE_KEY,
      secretKey: env.TURNSTILE_SECRET_KEY,
    });
  }
  return { provider: "fake" };
}
