const SECRET_KEY = /(password|secret|token|hash|ciphertext|totp|otp|code)/i;
const EMAIL_KEY = /^(.*email.*|to|recipient)$/i;
const USERNAME_KEY = /^username$/i;
const IBAN_KEY = /iban/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Context = { email: boolean; iban: boolean };

function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at < 1) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.charAt(0)}***@${host.charAt(0)}***${tld}`;
}

function lastFour(value: string): string {
  return value.slice(-4);
}

function redactString(value: string, ctx: Context): string {
  if (ctx.iban) return lastFour(value);
  if (ctx.email || EMAIL_VALUE.test(value)) return maskEmail(value);
  return value;
}

function walk(value: unknown, ctx: Context): unknown {
  if (typeof value === "string") return redactString(value, ctx);
  if (Array.isArray(value)) return value.map((item) => walk(item, ctx));
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    const next: Context = {
      email:
        EMAIL_KEY.test(key) ||
        (USERNAME_KEY.test(key) && typeof inner === "string" && EMAIL_VALUE.test(inner)),
      iban: ctx.iban || IBAN_KEY.test(key),
    };
    out[key] = walk(inner, next);
  }
  return out;
}

/** Returns a deep copy with emails masked, IBANs cut to the last 4 and secret-like keys dropped. */
export function redact(value: unknown): unknown {
  return walk(value, { email: false, iban: false });
}
