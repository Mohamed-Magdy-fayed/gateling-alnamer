import { eq, or } from "drizzle-orm";
import { z } from "zod";
import type { Locale } from "@/i18n/config";
import { db } from "@/server/db";
import { credentials, users } from "@/server/db/schema";
import { cairoToday, isUnder18, MIN_BIRTH_YEAR, parseIsoDate } from "./age";
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

export type SignUpResult =
  | { ok: true; userId: string }
  | { ok: false; code: "invalid" | "duplicate"; fields: SignUpField[] };

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
function validDateOfBirth(value: string | undefined, now: Date): string | null {
  if (!value) return null;
  const parsed = parseIsoDate(value);
  if (!parsed || parsed.year < MIN_BIRTH_YEAR) return null;
  const today = cairoToday(now);
  return value <= today ? value : null;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  return isUniqueViolation((error as { cause?: unknown }).cause);
}

const invalid = (fields: SignUpField[]): SignUpResult => ({ ok: false, code: "invalid", fields });
const duplicate: SignUpResult = { ok: false, code: "duplicate", fields: [] };

/**
 * Validates a public sign-up and creates the account (users + credentials + public number in one
 * transaction). Public roles are student and parent only. Students need a date of birth; under 18 on
 * the Cairo date of `ctx.now` they must give guardian consent, adults must not. A taken email or
 * username returns one generic `duplicate` result that never says which.
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

  let dateOfBirth: string | null = null;
  let guardianConsentAt: Date | null = null;
  if (input.role === "student") {
    dateOfBirth = validDateOfBirth(input.date_of_birth, ctx.now);
    if (!dateOfBirth) return invalid(["date_of_birth"]);
    const minor = isUnder18(dateOfBirth, ctx.now);
    if (minor !== input.guardian_consent) return invalid(["guardian_consent"]);
    if (minor) guardianConsentAt = ctx.now;
  } else if (input.guardian_consent) {
    return invalid(["guardian_consent"]);
  }

  const taken = await conn.query.users.findFirst({
    columns: { id: true },
    where: input.username
      ? or(eq(users.email, input.email), eq(users.username, input.username))
      : eq(users.email, input.email),
  });
  if (taken) return duplicate;

  const passwordHash = await hashPassword(input.password);
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
    throw error;
  }
}
