import { eq, or } from "drizzle-orm";
import { z } from "zod";
import type { Locale } from "@/i18n/config";
import { MIN_STUDENT_SIGNUP_AGE } from "@/server/config/policy";
import { db } from "@/server/db";
import { credentials, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { ADULT_AGE, ageOn, cairoToday, isUnder18, MIN_BIRTH_YEAR, parseIsoDate } from "./age";
import { hashPassword } from "./password";
import { nextPublicNumber } from "./public-number";
import { usernameSchema } from "./username";

type Database = ReturnType<typeof db>;

export const SIGN_UP_ROLES = ["student", "parent"] as const;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type SignUpField =
  | "name"
  | "email"
  | "username"
  | "password"
  | "role"
  | "date_of_birth"
  | "guardian_consent";

/** Why a field failed when the generic "invalid" message is not enough (age rules). */
export type SignUpReason = "parentAge" | "studentMinAge";

export type SignUpResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      code: "invalid" | "duplicate";
      fields: SignUpField[];
      reasons?: Partial<Record<SignUpField, SignUpReason>>;
    };

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

const signUpSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().pipe(z.email()).pipe(z.string().max(254)),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  role: z.enum(SIGN_UP_ROLES),
  username: z.preprocess(emptyToUndefined, usernameSchema.optional()),
  date_of_birth: z.preprocess(emptyToUndefined, z.string().optional()),
  guardian_consent: z.preprocess(
    (value) => value === true || value === "on" || value === "true",
    z.boolean(),
  ),
});

const KNOWN_FIELDS: readonly SignUpField[] = [
  "name",
  "email",
  "username",
  "password",
  "role",
  "date_of_birth",
  "guardian_consent",
];

function isKnownField(value: unknown): value is SignUpField {
  return KNOWN_FIELDS.some((field) => field === value);
}

/** A birth date must be a real date from MIN_BIRTH_YEAR up to the Cairo date of `now`. */
export function validDateOfBirth(value: string | undefined, now: Date): string | null {
  if (!value) return null;
  const parsed = parseIsoDate(value);
  if (!parsed || parsed.year < MIN_BIRTH_YEAR) return null;
  const today = cairoToday(now);
  return value <= today ? value : null;
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  return isUniqueViolation((error as { cause?: unknown }).cause);
}

const invalid = (
  fields: SignUpField[],
  reasons?: Partial<Record<SignUpField, SignUpReason>>,
): SignUpResult => ({ ok: false, code: "invalid", fields, ...(reasons ? { reasons } : {}) });
const duplicate: SignUpResult = { ok: false, code: "duplicate", fields: [] };

/** Postgres error code from a driver error (or its cause), never its message (that quotes the row). */
function pgCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return pgCode((error as { cause?: unknown }).cause);
}

/**
 * The public sign-up age rules (D31), shared by password and Google sign-up: parents 18+,
 * students 8+, guardian consent exactly when the student is under 18 on the Cairo date of `now`.
 */
export function checkSignUpAge(
  role: "student" | "parent",
  rawDateOfBirth: string,
  guardianConsent: boolean,
  now: Date,
):
  | { ok: true; dateOfBirth: string; guardianConsentAt: Date | null }
  | { ok: false; result: SignUpResult } {
  const dateOfBirth = validDateOfBirth(rawDateOfBirth, now);
  if (!dateOfBirth) return { ok: false, result: invalid(["date_of_birth"]) };
  if (role === "student") {
    if (ageOn(dateOfBirth, now) < MIN_STUDENT_SIGNUP_AGE) {
      return { ok: false, result: invalid(["date_of_birth"], { date_of_birth: "studentMinAge" }) };
    }
    const minor = isUnder18(dateOfBirth, now);
    if (minor !== guardianConsent) return { ok: false, result: invalid(["guardian_consent"]) };
    return { ok: true, dateOfBirth, guardianConsentAt: minor ? now : null };
  }
  if (ageOn(dateOfBirth, now) < ADULT_AGE) {
    return { ok: false, result: invalid(["date_of_birth"], { date_of_birth: "parentAge" }) };
  }
  if (guardianConsent) return { ok: false, result: invalid(["guardian_consent"]) };
  return { ok: true, dateOfBirth, guardianConsentAt: null };
}

/**
 * Validates a public sign-up and creates the account (users + credentials + public number in one
 * transaction). Public roles are student and parent only. Both give a date of birth: parents must be
 * 18 or older, students 8 or older (younger children are created by a parent); a student under 18 on
 * the Cairo date of `ctx.now` must give guardian consent, everyone else must not. A taken email or
 * username returns one generic `duplicate` result that never says which, after the same one password
 * hash a free sign-up costs.
 */
export async function signUpUser(
  raw: Record<string, unknown>,
  ctx: { locale: Locale; now: Date },
  conn: Database = db(),
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = new Set<SignUpField>();
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (isKnownField(key)) fields.add(key);
    }
    return invalid([...fields]);
  }
  const input = parsed.data;

  const age = checkSignUpAge(
    input.role,
    input.date_of_birth ?? "",
    input.guardian_consent,
    ctx.now,
  );
  if (!age.ok) return age.result;
  const { dateOfBirth, guardianConsentAt } = age;

  // One argon2 hash on every path, so a taken email or username costs the same as a free one.
  const passwordHash = await hashPassword(input.password);

  const taken = await conn.query.users.findFirst({
    columns: { id: true },
    where: input.username
      ? or(eq(users.email, input.email), eq(users.username, input.username))
      : eq(users.email, input.email),
  });
  if (taken) return duplicate;

  try {
    const userId = await conn.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          username: input.username ?? null,
          role: input.role,
          dateOfBirth,
          guardianConsentAt,
          locale: ctx.locale,
          publicNumber: await nextPublicNumber(tx),
        })
        .returning({ id: users.id });
      if (!user) throw new Error("User insert returned no row");
      await tx.insert(credentials).values({ userId: user.id, passwordHash, passwordSalt: null });
      return user.id;
    });
    return { ok: true, userId };
  } catch (error) {
    // Lost a race with a concurrent sign-up for the same email or username.
    if (isUniqueViolation(error)) return duplicate;
    // The driver's message quotes the row (email included): log the PG code only, throw a bare error.
    console.error(`[auth] sign-up failed (pg ${pgCode(error)})`);
    throw new AppError("internal");
  }
}
