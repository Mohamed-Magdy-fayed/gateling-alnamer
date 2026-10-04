import { z } from "zod";

// Category input rules (C3). Messages are dictionary keys (`categories.errors.*`).

const MAX_NAME = 80;
const MAX_SLUG = 60;

/**
 * Characters nobody sees: C0/C1 controls (NUL breaks the insert), zero-width and direction marks,
 * bidi overrides and isolates, and the BOM. They can reorder or spoof a name, so they are dropped.
 * Written as escapes so no invisible character sits in the source.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

const name = (field: "nameAr" | "nameEn") =>
  z
    .string()
    .transform((value) => value.replace(HIDDEN, "").trim())
    .pipe(
      z
        .string()
        .min(1, `categories.errors.${field}Required`)
        .max(MAX_NAME, `categories.errors.${field}Length`),
    );

/** Both names are required: the catalogue filters show them in either language. */
export const categoryNamesInput = z.object({ nameAr: name("nameAr"), nameEn: name("nameEn") });

/** Lowercase words joined by single hyphens; it ends up in catalogue URLs (C6). */
export const slugInput = z
  .string()
  .max(MAX_SLUG, "categories.errors.slugInvalid")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "categories.errors.slugInvalid");

/** A slug from free text: accents dropped, anything else non-alphanumeric becomes a hyphen. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}
