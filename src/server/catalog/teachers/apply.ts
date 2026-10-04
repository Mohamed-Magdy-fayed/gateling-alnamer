import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Locale } from "@/i18n/config";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { users } from "@/server/db/schema";
import {
  adultDateOfBirth,
  insertTeacher,
  type TeacherField,
  teacherEmailSchema,
  teacherNameSchema,
  teacherNoteSchema,
  teacherPasswordSchema,
} from "./account";

const applySchema = z.object({
  name: teacherNameSchema,
  email: teacherEmailSchema,
  password: teacherPasswordSchema,
  date_of_birth: z.string(),
  note: teacherNoteSchema,
});

const FIELDS: readonly TeacherField[] = ["name", "email", "password", "date_of_birth", "note"];
const isField = (value: unknown): value is TeacherField => FIELDS.some((field) => field === value);

export type ApplyResult =
  | { ok: true; userId: string }
  | { ok: false; code: "invalid"; fields: TeacherField[] }
  | { ok: false; code: "duplicate" };

/**
 * A teacher application (C1): a new account with role `teacher` and status `applied`, audit
 * `teacher.applied`. Adults only. Like sign-up, a taken email answers one generic `duplicate`
 * after the same password hash a free one costs. The caller rate-limits (sign-up limits) and
 * sends the verification and "application received" emails.
 */
export async function applyAsTeacher(
  raw: Record<string, unknown>,
  ctx: { locale: Locale; now: Date },
): Promise<ApplyResult> {
  const parsed = applySchema.safeParse(raw);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]).filter(isField));
    return { ok: false, code: "invalid", fields: [...fields] };
  }
  const input = parsed.data;
  const dateOfBirth = adultDateOfBirth(input.date_of_birth, ctx.now);
  if (!dateOfBirth) return { ok: false, code: "invalid", fields: ["date_of_birth"] };

  const passwordHash = await hashPassword(input.password);
  const taken = await db().query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, input.email),
  });
  if (taken) return { ok: false, code: "duplicate" };
  try {
    const userId = await db().transaction((tx) =>
      insertTeacher(
        tx,
        {
          name: input.name,
          email: input.email,
          passwordHash,
          dateOfBirth,
          locale: ctx.locale,
          emailVerifiedAt: null,
          status: "applied",
          applicationNote: input.note,
          decidedBy: null,
          decidedAt: null,
        },
        "teacher.applied",
      ),
    );
    return { ok: true, userId };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "duplicate" };
    throw error;
  }
}
