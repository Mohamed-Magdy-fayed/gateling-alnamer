const SECRET_KEY = /(password|secret|token|hash|ciphertext|totp|otp|code)/i;
const EMAIL_KEY = /email/i;
const IBAN_KEY = /iban/i;

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

/** Returns a deep copy with emails masked, IBANs cut to the last 4 and secret-like keys dropped. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof inner === "string" && EMAIL_KEY.test(key)) out[key] = maskEmail(inner);
    else if (typeof inner === "string" && IBAN_KEY.test(key)) out[key] = lastFour(inner);
    else out[key] = redact(inner);
  }
  return out;
}
