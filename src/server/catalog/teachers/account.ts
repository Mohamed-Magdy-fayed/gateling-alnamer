import "server-only";
import { z } from "zod";
import type { Locale } from "@/i18n/config";
import { writeAudit } from "@/server/audit/repository";
import { ADULT_AGE, ageOn } from "@/server/auth/age";
import { passwordSchema } from "@/server/auth/password-policy";
import { nextPublicNumber } from "@/server/auth/public-number";
import { validDateOfBirth } from "@/server/auth/sign-up";
import type { db } from "@/server/db";
import { credentials, teacherProfiles, users } from "@/server/db/schema";

// Creating a teacher account (C1): by application (status `applied`) or by an admin's invite
// (status `approved` at once). One account, one role: teachers are never converted students.

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export const MAX_TEXT = 1000;

export type TeacherField = "name" | "email" | "password" | "date_of_birth" | "note";

export const teacherNameSchema = z.string().trim().min(2).max(80);
export const teacherEmailSchema = z.string().trim().pipe(z.email()).pipe(z.string().max(254));
export const teacherPasswordSchema = passwordSchema;
export const teacherNoteSchema = z.string().trim().min(10).max(MAX_TEXT);

/** Teachers are adults: a valid date of birth, 18 or older on the Cairo date of `now`. */
export function adultDateOfBirth(raw: string, now: Date): string | null {
  const dateOfBirth = validDateOfBirth(raw, now);
  return dateOfBirth && ageOn(dateOfBirth, now) >= ADULT_AGE ? dateOfBirth : null;
}

export type NewTeacher = {
  name: string;
  email: string;
  passwordHash: string;
  dateOfBirth: string;
  locale: Locale;
  emailVerifiedAt: Date | null;
  status: "applied" | "approved";
  applicationNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
};

/** The user, its credential and its teacher profile, plus the audit row, in the caller's transaction. */
export async function insertTeacher(tx: Tx, teacher: NewTeacher, action: string): Promise<string> {
  const [user] = await tx
    .insert(users)
    .values({
      name: teacher.name,
      email: teacher.email,
      role: "teacher",
      dateOfBirth: teacher.dateOfBirth,
      locale: teacher.locale,
      emailVerifiedAt: teacher.emailVerifiedAt,
      publicNumber: await nextPublicNumber(tx),
    })
    .returning({ id: users.id });
  if (!user) throw new Error("teacher insert returned no row");
  await tx.insert(credentials).values({ userId: user.id, passwordHash: teacher.passwordHash });
  await tx.insert(teacherProfiles).values({
    userId: user.id,
    publicName: { [teacher.locale]: teacher.name },
    bio: {},
    status: teacher.status,
    applicationNote: teacher.applicationNote,
    decidedBy: teacher.decidedBy,
    decidedAt: teacher.decidedAt,
  });
  await writeAudit(tx, {
    actorId: teacher.decidedBy ?? user.id,
    action,
    subjectType: "user",
    subjectId: user.id,
    after: { status: teacher.status },
  });
  return user.id;
}
