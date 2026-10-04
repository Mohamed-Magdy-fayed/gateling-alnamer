// IBAN checks for teacher payout details (C2): the countries the platform pays out to, each with
// its fixed IBAN length, and the ISO 13616 mod-97 check. Pure, so client and server share it.

import { toLatinDigits } from "@/lib/digits";

/** Supported payout countries and their IBAN lengths. */
export const IBAN_COUNTRIES = {
  AE: 23,
  SA: 24,
  JO: 30,
  QA: 29,
  KW: 30,
  BH: 22,
  OM: 23,
  EG: 29,
} as const satisfies Record<string, number>;

export type IbanCountry = keyof typeof IBAN_COUNTRIES;

export type IbanResult =
  | { ok: true; iban: string; country: IbanCountry; last4: string }
  | { ok: false; reason: "format" | "country" | "length" | "checksum" };

const SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]+$/;

/** Spaces and dashes removed, upper case, Arabic-Indic digits turned Latin. */
export function normalizeIban(raw: string): string {
  return toLatinDigits(raw.replace(/[\s-]/g, "")).toUpperCase();
}

function isCountry(code: string): code is IbanCountry {
  return Object.hasOwn(IBAN_COUNTRIES, code);
}

/** ISO 13616: move the first four characters to the end, letters to 10..35, remainder mod 97 is 1. */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= "A" ? char.charCodeAt(0) - 55 : Number(char);
    remainder = (remainder * (value > 9 ? 100 : 10) + value) % 97;
  }
  return remainder;
}

export function validateIban(raw: string): IbanResult {
  const iban = normalizeIban(raw);
  if (!SHAPE.test(iban)) return { ok: false, reason: "format" };
  const country = iban.slice(0, 2);
  if (!isCountry(country)) return { ok: false, reason: "country" };
  if (iban.length !== IBAN_COUNTRIES[country]) return { ok: false, reason: "length" };
  if (mod97(iban) !== 1) return { ok: false, reason: "checksum" };
  return { ok: true, iban, country, last4: iban.slice(-4) };
}
