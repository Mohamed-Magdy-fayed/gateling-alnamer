import { z } from "zod";

// Category input rules (C3). Messages are dictionary keys (`categories.errors.*`).

const MAX_NAME = 80;
const MAX_SLUG = 60;

/** Bidi override and isolate controls: they can visually reorder text around a name. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

const name = z
  .string()
  .transform((value) => value.replace(BIDI_CONTROLS, "").trim())
  .pipe(
    z
      .string()
      .min(1, "categories.errors.nameRequired")
      .max(MAX_NAME, "categories.errors.nameLength"),
  );

/** Both names are required: the catalogue filters show them in either language. */
export const categoryNamesInput = z.object({ nameAr: name, nameEn: name });

export type CategoryNames = z.infer<typeof categoryNamesInput>;

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
