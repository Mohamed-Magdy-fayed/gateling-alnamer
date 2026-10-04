import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Locale } from "@/i18n/config";
import { writeAudit } from "@/server/audit/repository";
import { type AbuseDeps, guardTeacherInvite } from "@/server/auth/abuse";
import { authKey, keyedHash } from "@/server/auth/keys";
import { hashPassword } from "@/server/auth/password";
import { clock } from "@/server/clock";
import { TEACHER_INVITE_TTL_MS } from "@/server/config/policy";
import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { teacherInvites, users } from "@/server/db/schema";
import {
  adultDateOfBirth,
  insertTeacher,
  teacherEmailSchema,
  teacherNameSchema,
  teacherPasswordSchema,
} from "./account";

// Admin invitations to teach (C1). The link carries 32 random bytes; the table keeps their HMAC
// under the `invite` sub-key (domain-separated from parent invite codes). An invite is the
// approval: the new account is `approved` at once, and the terms are still required.

const tokenHash = (token: string): string =>
  keyedHash(authKey("invite"), `teacher-invite:${token}`);

export type IssueInviteResult =
  | { ok: true; token: string; name: string; email: string }
  | { ok: false; reason: "invalid" | "exists" | "rate_limited" };

export async function issueTeacherInvite(
  input: { adminId: string; name: string; email: string },
  deps: AbuseDeps = {},
): Promise<IssueInviteResult> {
  const name = teacherNameSchema.safeParse(input.name);
  const email = teacherEmailSchema.safeParse(input.email);
  if (!name.success || !email.success) return { ok: false, reason: "invalid" };
  const guard = await guardTeacherInvite({ adminId: input.adminId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "rate_limited" };
  // Admins see every account anyway: an existing address is answered plainly.
  const existing = await db().query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, email.data),
  });
  if (existing) return { ok: false, reason: "exists" };
  const token = randomBytes(32).toString("base64url");
  await db().transaction(async (tx) => {
    // A new invite replaces any live one for the address (a mistyped or resent link stops working).
    const now = clock.now();
    await tx
      .update(teacherInvites)
      .set({ usedAt: now })
      .where(
        and(
          eq(teacherInvites.email, email.data),
          isNull(teacherInvites.usedAt),
          gt(teacherInvites.expiresAt, now),
        ),
      );
    const id = uuidv7();
    await tx.insert(teacherInvites).values({
      id,
      email: email.data,
      name: name.data,
      tokenHash: tokenHash(token),
      invitedBy: input.adminId,
      expiresAt: new Date(clock.now().getTime() + TEACHER_INVITE_TTL_MS),
    });
    await writeAudit(tx, {
      actorId: input.adminId,
      action: "teacher.invited",
      subjectType: "teacher_invite",
      subjectId: id,
    });
  });
  return { ok: true, token, name: name.data, email: email.data };
}

const liveInvite = (token: string) =>
  and(
    eq(teacherInvites.tokenHash, tokenHash(token)),
    isNull(teacherInvites.usedAt),
    gt(teacherInvites.expiresAt, clock.now()),
  );

/** The name and email of a usable invite (the redeem page), or null. */
export async function peekTeacherInvite(
  token: string,
): Promise<{ name: string; email: string } | null> {
  if (token.length === 0 || token.length > 128) return null;
  const [row] = await db()
    .select({ name: teacherInvites.name, email: teacherInvites.email })
    .from(teacherInvites)
    .where(liveInvite(token))
    .limit(1);
  return row ?? null;
}

export type RedeemInviteResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_link" | "taken" }
  | { ok: false; reason: "fields"; fields: Array<"password" | "date_of_birth"> };

/**
 * Creates the invited teacher: approved by the inviter, email verified (the link proved the
 * mailbox), audit `teacher.invite_redeemed`. The invite is spent in the same transaction.
 */
export async function redeemTeacherInvite(input: {
  token: string;
  password: string;
  dateOfBirth: string;
  locale: Locale;
}): Promise<RedeemInviteResult> {
  const now = clock.now();
  const fields: Array<"password" | "date_of_birth"> = [];
  if (!teacherPasswordSchema.safeParse(input.password).success) fields.push("password");
  const dateOfBirth = adultDateOfBirth(input.dateOfBirth, now);
  if (!dateOfBirth) fields.push("date_of_birth");
  if (fields.length > 0 || !dateOfBirth) return { ok: false, reason: "fields", fields };
  if (input.token.length === 0 || input.token.length > 128)
    return { ok: false, reason: "invalid_link" };
  const passwordHash = await hashPassword(input.password);
  try {
    return await db().transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(teacherInvites)
        .where(liveInvite(input.token))
        .for("update");
      if (!invite) return { ok: false, reason: "invalid_link" } as const;
      const userId = await insertTeacher(
        tx,
        {
          name: invite.name,
          email: invite.email,
          passwordHash,
          dateOfBirth,
          locale: input.locale,
          emailVerifiedAt: now,
          status: "approved",
          applicationNote: null,
          decidedBy: invite.invitedBy,
          decidedAt: now,
        },
        "teacher.invite_redeemed",
      );
      await tx.update(teacherInvites).set({ usedAt: now }).where(eq(teacherInvites.id, invite.id));
      return { ok: true, userId } as const;
    });
  } catch (error) {
    // Someone signed up with the invited address meanwhile.
    if (isUniqueViolation(error)) return { ok: false, reason: "taken" };
    throw error;
  }
}
