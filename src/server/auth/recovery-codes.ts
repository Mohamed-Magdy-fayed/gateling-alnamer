import { randomBytes } from "node:crypto";

// Recovery codes for two-factor sign-in: 8 Crockford base32 characters (40 bits), shown as XXXX-XXXX.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 8;
const COUNT = 10;
/** Crockford's decoding of letters people confuse with digits. */
const CONFUSABLE: Record<string, string> = { I: "1", L: "1", O: "0" };

function newCode(): string {
  const bytes = randomBytes(LENGTH);
  let out = "";
  for (const byte of bytes) out += ALPHABET.charAt(byte & 31);
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Ten distinct codes, shown to the user once. */
export function newRecoveryCodes(count = COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(newCode());
  return [...codes];
}

/** The canonical 8 characters of what a person typed, or null when it cannot be a code. */
export function normalizeRecoveryCode(input: string): string | null {
  const compact = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .split("")
    .map((char) => CONFUSABLE[char] ?? char)
    .join("");
  if (compact.length !== LENGTH) return null;
  for (const char of compact) if (!ALPHABET.includes(char)) return null;
  return compact;
}
