export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ar";
export const LOCALE_COOKIE = "locale";
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

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

/** Clock time (hours and minutes, Latin digits) on the platform's Cairo clock, whatever the server's zone. */
export function formatTime(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  }).format(date);
}

/** Arabic needs every CLDR category; each form holds a `{count}` placeholder where it reads naturally. */
export type ArPlural = Record<"zero" | "one" | "two" | "few" | "many" | "other", string>;
/** English only distinguishes one / other. */
export type EnPlural = Record<"one" | "other", string>;
export type PluralForms = ArPlural | EnPlural;

/** Picks the CLDR plural form for `count` via Intl.PluralRules and fills `{count}` with Latin digits. */
export function plural(locale: Locale, forms: PluralForms, count: number): string {
  const category = new Intl.PluralRules(locale === "ar" ? "ar" : "en").select(count);
  const template = category in forms ? forms[category as keyof PluralForms] : forms.other;
  return format(template, { count: formatNumber(locale, count) });
}
