"use server";

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { format } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { clock } from "@/server/clock";
import { RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS } from "@/server/config/policy";
import { db } from "@/server/db";
import { credentials, passwordResetCodes, users } from "@/server/db/schema";
import { sendEvent } from "@/server/jobs/send";
import { authenticate } from "./credentials";
import { hashPassword, randomCode, sha256 } from "./password";
import { createSession, destroyAllSessions, destroySession } from "./session";

export type FormState = { status: "idle" | "error" | "success"; message?: string; email?: string };

const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));
const password = z.string().min(8).max(128);

const signUpSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  password,
  role: z.enum(["student", "parent", "teacher"]),
});
const signInSchema = z.object({ email, password: z.string().min(1).max(128) });
const forgotSchema = z.object({ email });
const resetSchema = z.object({ email, code: z.string().regex(/^\d{6}$/), password });

function fields(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await getDictionary();
  const parsed = signUpSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: t.auth.errors.invalid };
  const input = parsed.data;

  const existing = await db().query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, input.email),
  });
  if (existing) return { status: "error", message: t.auth.errors.duplicate };

  const passwordHash = await hashPassword(input.password);
  const userId = await db().transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, role: input.role })
      .returning({ id: users.id });
    if (!user) throw new Error("User insert returned no row");
    await tx.insert(credentials).values({ userId: user.id, passwordHash, passwordSalt: null });
    return user.id;
  });

  await createSession(userId);
  redirect("/dashboard");
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await getDictionary();
  const parsed = signInSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: t.auth.errors.credentials };

  const userId = await authenticate(parsed.data.email, parsed.data.password);
  if (!userId) return { status: "error", message: t.auth.errors.credentials };

  await createSession(userId);
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t, locale } = await getDictionary();
  const parsed = forgotSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: t.auth.errors.invalid };

  const user = await db().query.users.findFirst({
    columns: { id: true, name: true, email: true },
    where: eq(users.email, parsed.data.email),
  });
  // Same answer whether or not the email exists (no account enumeration).
  const sent: FormState = {
    status: "success",
    message: t.auth.forgot.sent,
    email: parsed.data.email,
  };
  if (!user?.email) return sent;

  const code = randomCode();
  const codeHash = sha256(`${user.email}:${code}`);
  const [row] = await db().transaction(async (tx) => {
    await tx.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, user.id));
    return tx
      .insert(passwordResetCodes)
      .values({
        userId: user.id,
        codeHash,
        expiresAt: new Date(clock.now().getTime() + RESET_CODE_TTL_MS),
      })
      .returning({ id: passwordResetCodes.id });
  });

  try {
    const body = format(t.auth.resetEmail.body, { name: user.name, code });
    await sendEvent("email/send", {
      to: user.email,
      subject: t.auth.resetEmail.subject,
      text: body,
      html: `<div dir="${locale === "ar" ? "rtl" : "ltr"}" style="font-family:sans-serif;white-space:pre-line">${escapeHtml(body)}</div>`,
    });
  } catch (error) {
    console.error("Password reset email failed", error instanceof Error ? error.message : error);
    if (row) await db().delete(passwordResetCodes).where(eq(passwordResetCodes.id, row.id));
    return { status: "error", message: t.auth.errors.email };
  }
  return sent;
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await getDictionary();
  const parsed = resetSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: t.auth.errors.invalid };
  const input = parsed.data;

  const user = await db().query.users.findFirst({
    columns: { id: true, email: true },
    where: eq(users.email, input.email),
  });
  if (!user) return { status: "error", message: t.auth.errors.code };

  const [record] = await db()
    .select()
    .from(passwordResetCodes)
    .where(
      and(
        eq(passwordResetCodes.userId, user.id),
        isNull(passwordResetCodes.consumedAt),
        gt(passwordResetCodes.expiresAt, clock.now()),
      ),
    )
    .orderBy(desc(passwordResetCodes.createdAt))
    .limit(1);
  if (!record || record.attempts >= RESET_MAX_ATTEMPTS) {
    return { status: "error", message: t.auth.errors.code };
  }
  if (record.codeHash !== sha256(`${user.email}:${input.code}`)) {
    await db()
      .update(passwordResetCodes)
      .set({ attempts: sql`${passwordResetCodes.attempts} + 1` })
      .where(eq(passwordResetCodes.id, record.id));
    return { status: "error", message: t.auth.errors.code };
  }

  const passwordHash = await hashPassword(input.password);
  const now = clock.now();
  await db().transaction(async (tx) => {
    await tx
      .insert(credentials)
      .values({ userId: user.id, passwordHash, passwordSalt: null, updatedAt: now })
      .onConflictDoUpdate({
        target: credentials.userId,
        set: { passwordHash, passwordSalt: null, updatedAt: now },
      });
    await tx
      .update(passwordResetCodes)
      .set({ consumedAt: now })
      .where(eq(passwordResetCodes.id, record.id));
  });
  // A password reset signs the account out everywhere.
  await destroyAllSessions(user.id);
  return { status: "success", message: t.auth.reset.done };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
