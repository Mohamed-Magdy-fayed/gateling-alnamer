import "server-only";
import { deriveKey, resolveAuthSecret } from "@/server/auth/keys";
import { open, seal } from "@/server/auth/secret-box";
import { decodeKey32 } from "@/server/env-schema";

// Teacher IBANs at rest (C2): AES-256-GCM under IBAN_ENCRYPTION_KEY, with the teacher's user id as
// additional data, so a ciphertext copied onto another teacher's row does not open. Each row
// stores the key version; during a rotation IBAN_ENCRYPTION_KEY_PREVIOUS opens version - 1 rows
// until `npm run iban:rotate` has re-sealed them (docs/deploy.md).

type Env = Readonly<Record<string, string | undefined>>;

export type IbanKeyring = { readonly version: number; readonly keys: ReadonlyMap<number, Buffer> };

export type SealedIban = { ciphertext: string; keyVersion: number };

/**
 * The keyring from the environment (env-schema has already checked the shapes). Outside live, a
 * missing key falls back to a sub-key of AUTH_SECRET so the demo works without one more secret.
 */
export function ibanKeyring(env: Env = process.env): IbanKeyring {
  const version = Number(env.IBAN_KEY_VERSION ?? 1);
  const keys = new Map<number, Buffer>();
  const current = decodeKey32(env.IBAN_ENCRYPTION_KEY);
  if (current) {
    keys.set(version, current);
  } else if (env.APP_MODE === "live") {
    throw new Error("IBAN_ENCRYPTION_KEY is required when APP_MODE=live");
  } else {
    keys.set(version, deriveKey(resolveAuthSecret(env), "iban"));
  }
  const previous = decodeKey32(env.IBAN_ENCRYPTION_KEY_PREVIOUS);
  if (previous && version > 1) keys.set(version - 1, previous);
  return { version, keys };
}

/** Seals under the current key, bound to the teacher. */
export function sealIban(ring: IbanKeyring, teacherId: string, iban: string): SealedIban {
  const key = ring.keys.get(ring.version);
  if (!key) throw new Error("IBAN keyring has no current key");
  return { ciphertext: seal(key, iban, aadFor(teacherId)), keyVersion: ring.version };
}

/** The IBAN, or null when the key version is unknown, the row was moved or the value tampered. */
export function openIban(ring: IbanKeyring, teacherId: string, sealed: SealedIban): string | null {
  const key = ring.keys.get(sealed.keyVersion);
  return key ? open(key, sealed.ciphertext, aadFor(teacherId)) : null;
}

function aadFor(teacherId: string): string {
  return `iban|${teacherId}`;
}
