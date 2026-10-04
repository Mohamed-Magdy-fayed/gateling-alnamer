import { createHmac, randomBytes } from "node:crypto";

/**
 * One root secret, `AUTH_SECRET`, and an HMAC-derived sub-key per use, so a key leaked or misused in
 * one place (a cookie MAC, a limiter key) is no use in another and none of them is a bare hash.
 * env-schema requires the secret when APP_MODE=live or on Vercel.
 */
export type KeyPurpose =
  | "codes"
  | "rl"
  | "rp"
  | "did"
  | "invite"
  | "media"
  | "totp"
  | "totp-finish"
  | "recovery"
  | "oauth"
  | "iban";

const MIN_SECRET_LENGTH = 32;

/** HMAC-SHA256(secret, purpose): the sub-key for one purpose. */
export function deriveKey(secret: string, purpose: KeyPurpose): Buffer {
  return createHmac("sha256", secret).update(purpose).digest();
}

/** Hex HMAC-SHA256 of `value` under `key`: what replaces a bare sha256 of anything guessable. */
export function keyedHash(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

let processSecret: string | undefined;

/**
 * The root secret. When it is unset (demo off Vercel) one random secret per process is used and a
 * single warning says so: cookies and live codes then do not survive a restart. Never logged.
 */
export function resolveAuthSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env.AUTH_SECRET;
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;
  if (!processSecret) {
    processSecret = randomBytes(32).toString("base64url");
    console.warn(
      "AUTH_SECRET is not set; using a per-process secret (device cookies and codes reset on restart).",
    );
  }
  return processSecret;
}

export function authKey(
  purpose: KeyPurpose,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Buffer {
  return deriveKey(resolveAuthSecret(env), purpose);
}
