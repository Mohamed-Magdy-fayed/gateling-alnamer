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
  /** A misconfiguration (no secret for turnstile, no provider): nothing verifies. */
  | { readonly provider: "closed" }
  | {
      readonly provider: "turnstile";
      readonly secretKey: string;
      /** The host the widget ran on (BASE_URL's); an answer minted for another host is refused. */
      readonly expectedHostname?: string;
      /** The widget action; checked only when one is configured. */
      readonly expectedAction?: string;
      /** Injectable for tests. */
      readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
      readonly timeoutMs?: number;
    };

/** What the browser needs: the provider and, for Turnstile, the public site key. Never the secret. */
export type CaptchaConfig =
  | { readonly provider: "fake" }
  | { readonly provider: "turnstile"; readonly siteKey: string };

const siteverifyAnswer = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

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
    if (!answer.success || !answer.data.success) return false;
    const { expectedHostname, expectedAction } = settings;
    if (expectedHostname && answer.data.hostname !== expectedHostname) return false;
    return !expectedAction || answer.data.action === expectedAction;
  } catch {
    // Network error, timeout or malformed body: a challenge that cannot be checked is not passed.
    return false;
  }
}

export function createCaptchaVerifier(settings: CaptchaSettings): CaptchaVerifier {
  return async (token, ip) => {
    const value = token?.trim();
    if (!value) return false;
    if (settings.provider === "closed") return false;
    if (settings.provider === "fake") return value !== FAKE_CAPTCHA_FAIL_TOKEN;
    return verifyWithTurnstile(settings, value, ip);
  };
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Provider settings from the validated environment. Only an explicit fake provider is the fake;
 * turnstile without its secret, or any other state, fails closed instead of quietly accepting
 * tokens. env-schema already refuses those states, so this is the second lock.
 */
export function settingsFromEnvironment(env: {
  providers: { captcha?: "turnstile" | "fake" | undefined };
  TURNSTILE_SECRET_KEY?: string | undefined;
  BASE_URL?: string | undefined;
}): CaptchaSettings {
  if (env.providers.captcha === "fake") return { provider: "fake" };
  if (env.providers.captcha === "turnstile" && env.TURNSTILE_SECRET_KEY) {
    return {
      provider: "turnstile",
      secretKey: env.TURNSTILE_SECRET_KEY,
      expectedHostname: hostOf(env.BASE_URL),
    };
  }
  return { provider: "closed" };
}

export const verifyCaptcha: CaptchaVerifier = (token, ip) =>
  createCaptchaVerifier(settingsFromEnvironment(serverEnv()))(token, ip);

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
