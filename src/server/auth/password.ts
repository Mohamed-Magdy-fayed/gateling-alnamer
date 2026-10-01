import "server-only";
import crypto from "node:crypto";

const KEY_LENGTH = 64;

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, (error, hash) => {
      if (error) reject(error);
      else resolve(hash.toString("hex"));
    });
  });
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(await hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomCode(length = 6): string {
  return crypto
    .randomInt(0, 10 ** length)
    .toString()
    .padStart(length, "0");
}
