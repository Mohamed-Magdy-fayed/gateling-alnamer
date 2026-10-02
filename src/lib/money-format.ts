import type { Locale } from "@/i18n/config";

/** Money is integer minor units (MASTER-PLAN T15). AED has 2 decimals. */
export function formatPrice(locale: Locale, minor: number, currency: string): string {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : "en", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(minor / 100);
  return `${amount} ${currency}`;
}
