import { z } from "zod";

// The one password rule: 8 to 128 characters (sign-up, resets, a parent's child accounts).

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const isAcceptablePassword = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
