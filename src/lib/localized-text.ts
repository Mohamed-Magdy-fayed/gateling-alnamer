import { z } from "zod";

export type LocalizedText = { ar?: string; en?: string };

export type TextLocale = "ar" | "en";

/** At least one of `ar` / `en` must be a non-empty string. */
export const localizedTextSchema = z
  .object({ ar: z.string().optional(), en: z.string().optional() })
  .refine((v) => Boolean(v.ar) || Boolean(v.en), {
    message: "localized.required",
  });

/** The requested language, else the other one, else "". */
export function pickText(value: LocalizedText, locale: TextLocale): string {
  const other: TextLocale = locale === "ar" ? "en" : "ar";
  return value[locale] || value[other] || "";
}
