import { z } from "zod";

/** AED has 2 decimals; P1 replaces this with the ISO 4217 exponent of the platform currency. */
const MINOR_PER_UNIT = 100;

const required = (min: number, max: number, key: string) =>
  z
    .string()
    .trim()
    .min(1, `teach.errors.${key}Required`)
    .min(min, `teach.errors.${key}Length`)
    .max(max, `teach.errors.${key}Length`);

/**
 * A new draft course with its first lesson (T5). Arabic is required, English optional; messages
 * are dictionary keys (`teach.errors.*`).
 */
export const draftCourseInput = z.object({
  titleAr: required(3, 120, "title"),
  titleEn: z
    .string()
    .trim()
    .max(120, "teach.errors.titleLength")
    .refine((value) => value === "" || value.length >= 3, "teach.errors.titleLength"),
  descriptionAr: required(1, 2000, "description"),
  price: z
    .number("teach.errors.price")
    .int("teach.errors.price")
    .min(1, "teach.errors.price")
    .max(100_000, "teach.errors.price"),
  accessDays: z
    .number("teach.errors.days")
    .int("teach.errors.days")
    .min(1, "teach.errors.days")
    .max(365, "teach.errors.days"),
  lessonTitleAr: required(3, 120, "lessonTitle"),
  freePreview: z.boolean(),
});

export type DraftCourseInput = z.infer<typeof draftCourseInput>;

/** Whole currency units to minor units. */
export function priceToMinor(units: number): number {
  return units * MINOR_PER_UNIT;
}
