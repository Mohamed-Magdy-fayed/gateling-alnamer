import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 TOTP (HMAC-SHA1, 30 s steps, 6 digits), the scheme every authenticator app supports.
// Pure and dependency-free so the e2e helper can compute codes too (no "server-only" import).

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_S = 30;
const DIGITS = 6;
/** Codes from the previous and next step are accepted (clock drift). */
const WINDOW = 1;
const SECRET_BYTES = 20;
const ISSUER = "Al-Namer";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

/** Case-insensitive; spaces, dashes and `=` padding are ignored. Throws on other characters. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function codeForStep(secret: Uint8Array, step: number, digits: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The code for a Unix time in seconds. */
export function totpAt(secret: Uint8Array, timeS: number, digits = DIGITS): string {
  return codeForStep(secret, Math.floor(timeS / STEP_S), digits);
}

/**
 * The step a code matches within the window, or null. A step at or before `lastStep` (already
 * used) is refused, so a code cannot be replayed.
 */
export function verifyTotp(
  secret: Uint8Array,
  input: string,
  nowS: number,
  lastStep: number | null,
): number | null {
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowS / STEP_S);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(codeForStep(secret, step, DIGITS));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** A new random secret, base32 (what the authenticator app stores). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The `otpauth://` URI an authenticator app reads from the QR code. */
export function otpauthUri(secretBase32: string, account: string): string {
  const label = `${ISSUER}:${encodeURIComponent(account)}`;
  const params = `secret=${secretBase32}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
  return `otpauth://totp/${label}?${params}`;
}
