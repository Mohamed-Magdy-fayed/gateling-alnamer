import { randomInt } from "node:crypto";
import { authKey, keyedHash } from "@/server/auth/keys";

/** No 0/O/1/I/L/U: 30 symbols, read aloud and typed by children without mix-ups. */
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;

/** Eight random characters from the alphabet, unformatted. */
export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_ALPHABET.charAt(randomInt(INVITE_ALPHABET.length));
  }
  return code;
}

/** `XXXX-XXXX` for display. */
export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Upper-cases and drops dashes and whitespace, so what a child types matches what is stored. */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

/** HMAC under the `invite` sub-key of AUTH_SECRET (D33): a leaked table cannot be searched offline. */
export function hashInviteCode(raw: string): string {
  return keyedHash(authKey("invite"), normalizeInviteCode(raw));
}
