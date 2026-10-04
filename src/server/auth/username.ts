import { z } from "zod";

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20;
const USERNAME_PATTERN = /^[a-z0-9_.]+$/;

/** Names nobody may register. Compared after lower-casing. */
export const RESERVED_USERNAMES: readonly string[] = [
  "admin",
  "administrator",
  "support",
  "help",
  "root",
  "system",
  "alnamer",
  "teacher",
  "student",
  "parent",
  "reviewer",
  "api",
  "www",
  "mail",
];

/** Trims, lower-cases, then checks length, characters and the reserved list. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(USERNAME_PATTERN)
  .refine((value) => !RESERVED_USERNAMES.includes(value));
