import "server-only";
import crypto from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { DUMMY_PASSWORD_HASH } from "@/server/config/policy";

const KEY_LENGTH = 64;
const ARGON2ID_PREFIX = "$argon2id$";

/** OWASP argon2id parameters; `scripts/bench-argon2.mjs` measures them. */
const ARGON2_OPTIONS = {
  algorithm: 2, // Algorithm.Argon2id (a const enum, unusable under isolatedModules)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** The stored shape of a credential row. `passwordSalt` is only set for legacy scrypt rows. */
export type StoredCredential = { passwordHash: string; passwordSalt: string | null };

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Hashes with argon2id; the PHC string carries its own salt and parameters. */
export function hashPassword(password: string): Promise<string> {
  return argon2Hash(password.normalize("NFKC"), ARGON2_OPTIONS);
}

/** Legacy scrypt hash, kept only to verify (and in tests build) pre-argon2 credentials. */
export function hashLegacyScrypt(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, (error, hash) => {
      if (error) reject(error);
      else resolve(hash.toString("hex"));
    });
  });
}

export function isLegacyHash(credential: StoredCredential): boolean {
  return !credential.passwordHash.startsWith(ARGON2ID_PREFIX);
}

async function verifyArgon2(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2Verify(passwordHash, password.normalize("NFKC"));
  } catch {
    return false;
  }
}

export async function verifyPassword(
  password: string,
  credential: StoredCredential,
): Promise<boolean> {
  if (!isLegacyHash(credential)) return verifyArgon2(password, credential.passwordHash);
  if (!credential.passwordSalt) return false;
  const actual = Buffer.from(await hashLegacyScrypt(password, credential.passwordSalt), "hex");
  const expected = Buffer.from(credential.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Runs one argon2 verify against a fixed hash so unknown users cost the same as wrong passwords. */
export async function verifyDummy(password: string): Promise<false> {
  await verifyArgon2(password, DUMMY_PASSWORD_HASH);
  return false;
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
