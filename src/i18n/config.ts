export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ar";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined): value is Locale {
  return value === "ar" || value === "en";
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Replaces `{name}` placeholders. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** Latin digits in both locales (DESIGN.md T14). */
export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : "en", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn-ca-gregory" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Count phrases with one separate string per form; each holds a `{count}` placeholder where it reads naturally. */
export type CountForms = { one: string; two: string; few: string; many: string };

/**
 * Picks the Arabic-aware form for `count` (ar: 1 / 2 / 3-10 / 11+; en: 1 / other) and fills it in.
 * F2 replaces this with the shared plural helper.
 */
export function formatCount(locale: Locale, forms: CountForms, count: number): string {
  let form: keyof CountForms = "many";
  if (count === 1) form = "one";
  else if (locale === "ar" && count === 2) form = "two";
  else if (locale === "ar" && count >= 3 && count <= 10) form = "few";
  return format(forms[form], { count });
}
