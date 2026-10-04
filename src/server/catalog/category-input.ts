import { z } from "zod";
import { stripHidden } from "@/lib/hidden-chars";

// Category input rules (C3). Messages are dictionary keys (`categories.errors.*`).

const MAX_NAME = 80;
const MAX_SLUG = 60;

const name = (field: "nameAr" | "nameEn") =>
  z
    .string()
    .transform(stripHidden)
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
