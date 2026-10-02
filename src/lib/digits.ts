const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const DIGIT_COUNT = 10;

function latinDigit(char: string): string {
  const code = char.charCodeAt(0);
  for (const zero of [ARABIC_INDIC_ZERO, EXTENDED_ARABIC_INDIC_ZERO]) {
    if (code >= zero && code < zero + DIGIT_COUNT) return String(code - zero);
  }
  return char;
}

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits become 0-9, then every non-digit is dropped. */
export function onlyLatinDigits(value: string): string {
  return Array.from(value, latinDigit).join("").replace(/\D/g, "");
}
