import { randomBytes } from "node:crypto";

/** Crockford base32: no I, L, O or U, so a number read aloud or typed from a receipt is unambiguous. */
export const ORDER_NUMBER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ORDER_NUMBER_LENGTH = 8;

const SYMBOL_MASK = 31; // 32 symbols: a byte masked to 5 bits is uniform, no modulo bias.

/** Random, non-enumerable order number: 8 symbols, stored without the dash. */
export function generateOrderNumber(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(ORDER_NUMBER_LENGTH);
  let out = "";
  for (let i = 0; i < ORDER_NUMBER_LENGTH; i++) {
    out += ORDER_NUMBER_ALPHABET.charAt((bytes[i] ?? 0) & SYMBOL_MASK);
  }
  return out;
}

/** `ABCD1234` becomes `ABCD-1234` for display. */
export function formatOrderNumber(number: string): string {
  return `${number.slice(0, 4)}-${number.slice(4)}`;
}

/** Accepts what a person types (any case, optional dash); null when it cannot be an order number. */
export function parseOrderNumber(input: string): string | null {
  const compact = input.trim().replaceAll("-", "").toUpperCase();
  if (compact.length !== ORDER_NUMBER_LENGTH) return null;
  for (const char of compact) {
    if (!ORDER_NUMBER_ALPHABET.includes(char)) return null;
  }
  return compact;
}
