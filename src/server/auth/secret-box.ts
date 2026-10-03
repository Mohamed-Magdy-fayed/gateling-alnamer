import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for small secrets at rest (TOTP seeds). Format: v1.<iv>.<tag>.<ciphertext>, base64url.

const VERSION = "v1";
const IV_BYTES = 12;

/** Encrypts `plaintext` under a 32-byte key. */
export function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, body]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** The plaintext, or null for a wrong key, a tampered value or anything malformed. */
export function open(key: Buffer, sealed: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, body] = parts.map((part) => Buffer.from(part, "base64url"));
    if (!iv || !tag || !body || iv.length !== IV_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
