import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { stripHidden } from "@/lib/hidden-chars";
import { checkCurrentPassword } from "@/server/account/service";
import { writeAudit } from "@/server/audit/repository";
import { type AbuseDeps, guardIbanReveal, guardPayoutDetailsSet } from "@/server/auth/abuse";
import { REAUTH_WINDOW_MS } from "@/server/auth/reauth";
import { activeTeacherStatus } from "@/server/catalog/teachers/profile";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { sessions, teacherPayoutDetails, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { validateIban } from "./iban";
import { type IbanKeyring, ibanKeyring, openIban, sealIban } from "./payout-crypto";

// Teacher payout details (C2). A teacher saves holder, bank and IBAN with the current password;
// the IBAN is sealed and only its last 4 and country are ever read back. The full IBAN leaves this
// module only through `revealIban`, for a super admin on a two-factor session with a fresh
// re-auth, and every reveal is audited with the last 4 and the key version.

export type PayoutDeps = AbuseDeps & { ring?: IbanKeyring };

const MAX_NAME = 100;

const nameSchema = z.string().transform(stripHidden).pipe(z.string().min(1).max(MAX_NAME));

/** What a teacher and the admin list see: never the ciphertext, never the full IBAN. */
export type PayoutDetailsView = {
  holderName: string;
  bankName: string;
  ibanLast4: string;
  ibanCountry: string;
  updatedAt: Date;
};

export type SetPayoutDetailsResult =
  | { ok: true; view: PayoutDetailsView }
  | {
      ok: false;
      reason:
        | "not_teacher"
        | "limited"
        | "password"
        | "holder"
        | "bank"
        | "iban_format"
        | "iban_country"
        | "iban_length"
        | "iban_checksum";
    };

type SetInput = {
  teacherId: string;
  holderName: string;
  bankName: string;
  iban: string;
  currentPassword: string;
};

const viewColumns = {
  holderName: teacherPayoutDetails.holderName,
  bankName: teacherPayoutDetails.bankName,
  ibanLast4: teacherPayoutDetails.ibanLast4,
  ibanCountry: teacherPayoutDetails.ibanCountry,
  updatedAt: teacherPayoutDetails.updatedAt,
};

/** An active teacher whose profile is not suspended (they may add details before approval). */
async function isPayableTeacher(userId: string): Promise<boolean> {
  const status = await activeTeacherStatus(userId);
  return status !== null && status !== "suspended";
}

/** The current password under the account-change limit; null when it matches. */
async function passwordProblem(
  userId: string,
  password: string,
): Promise<"password" | "limited" | null> {
  try {
    await checkCurrentPassword(userId, password);
    return null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === "rate_limited") return "limited";
    if (error.code === "invalid_input") return "password";
    throw error;
  }
}

export async function setPayoutDetails(
  input: SetInput,
  deps: PayoutDeps = {},
): Promise<SetPayoutDetailsResult> {
  const { teacherId } = input;
  if (!(await isPayableTeacher(teacherId))) return { ok: false, reason: "not_teacher" };
  const guard = await guardPayoutDetailsSet({ userId: teacherId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "limited" };

  const holder = nameSchema.safeParse(input.holderName);
  if (!holder.success) return { ok: false, reason: "holder" };
  const bank = nameSchema.safeParse(input.bankName);
  if (!bank.success) return { ok: false, reason: "bank" };
  const iban = validateIban(input.iban);
  if (!iban.ok) return { ok: false, reason: `iban_${iban.reason}` };
  const wrong = await passwordProblem(teacherId, input.currentPassword);
  if (wrong) return { ok: false, reason: wrong };

  const sealed = sealIban(deps.ring ?? ibanKeyring(), teacherId, iban.iban);
  const now = clock.now();
  const values = {
    ibanCiphertext: sealed.ciphertext,
    ibanLast4: iban.last4,
    ibanCountry: iban.country,
    holderName: holder.data,
    bankName: bank.data,
    keyVersion: sealed.keyVersion,
    updatedAt: now,
  };
  const view = await db().transaction(async (tx) => {
    const [before] = await tx
      .select({ ...viewColumns, keyVersion: teacherPayoutDetails.keyVersion })
      .from(teacherPayoutDetails)
      .where(eq(teacherPayoutDetails.userId, teacherId))
      .for("update");
    const [saved] = await tx
      .insert(teacherPayoutDetails)
      .values({ userId: teacherId, ...values })
      .onConflictDoUpdate({ target: teacherPayoutDetails.userId, set: values })
      .returning(viewColumns);
    if (!saved) throw new Error("payout details upsert returned no row");
    await writeAudit(tx, {
      actorId: teacherId,
      action: "payout_details.set",
      subjectType: "user",
      subjectId: teacherId,
      before: before ? auditShape(before) : null,
      after: auditShape({ ...saved, keyVersion: sealed.keyVersion }),
    });
    return saved;
  });
  return { ok: true, view };
}

function auditShape(row: PayoutDetailsView & { keyVersion: number }) {
  return {
    ibanLast4: row.ibanLast4,
    ibanCountry: row.ibanCountry,
    keyVersion: row.keyVersion,
    holderName: row.holderName,
    bankName: row.bankName,
  };
}

/** The teacher's own details (last 4 only), or null when none are saved. */
export async function getPayoutDetailsView(teacherId: string): Promise<PayoutDetailsView | null> {
  const [row] = await db()
    .select(viewColumns)
    .from(teacherPayoutDetails)
    .where(eq(teacherPayoutDetails.userId, teacherId));
  return row ?? null;
}

export type AdminPayoutRow = PayoutDetailsView & { teacherId: string; teacherName: string };

/** Every teacher's saved details for the admin page, by teacher name (last 4 only). */
export async function listPayoutDetailsForAdmin(): Promise<AdminPayoutRow[]> {
  return db()
    .select({ teacherId: teacherPayoutDetails.userId, teacherName: users.name, ...viewColumns })
    .from(teacherPayoutDetails)
    .innerJoin(users, eq(users.id, teacherPayoutDetails.userId))
    .orderBy(asc(users.name), asc(teacherPayoutDetails.userId));
}

export type RevealResult =
  | { ok: true; iban: string }
  | { ok: false; reason: "forbidden" | "reauth" | "limited" | "not_found" | "unreadable" };

/**
 * The full IBAN for a super admin: active admin with `is_super_admin`, on this very session with
 * two-factor passed and a re-auth within the last 5 minutes. Audited in the same transaction as
 * the read; the plain text is returned only after the audit row is committed.
 */
export async function revealIban(
  input: { actorId: string; sessionTokenHash: string; teacherId: string },
  deps: PayoutDeps = {},
): Promise<RevealResult> {
  const { actorId, sessionTokenHash, teacherId } = input;
  const [session] = await db()
    .select({ verified: sessions.twoFactorVerified, reauthAt: sessions.reauthAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sessionTokenHash),
        eq(sessions.userId, actorId),
        gte(sessions.expiresAt, clock.now()),
        eq(users.role, "admin"),
        eq(users.isSuperAdmin, true),
        eq(users.status, "active"),
      ),
    );
  if (!session?.verified) return { ok: false, reason: "forbidden" };
  const freshSince = clock.now().getTime() - REAUTH_WINDOW_MS;
  if (!session.reauthAt || session.reauthAt.getTime() < freshSince) {
    return { ok: false, reason: "reauth" };
  }
  const guard = await guardIbanReveal({ userId: actorId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "limited" };

  const ring = deps.ring ?? ibanKeyring();
  return db().transaction(async (tx): Promise<RevealResult> => {
    const [row] = await tx
      .select({
        ciphertext: teacherPayoutDetails.ibanCiphertext,
        keyVersion: teacherPayoutDetails.keyVersion,
        ibanLast4: teacherPayoutDetails.ibanLast4,
      })
      .from(teacherPayoutDetails)
      .where(eq(teacherPayoutDetails.userId, teacherId));
    if (!row) return { ok: false, reason: "not_found" };
    const iban = openIban(ring, teacherId, {
      ciphertext: row.ciphertext,
      keyVersion: row.keyVersion,
    });
    if (!iban) {
      console.warn(
        `[alert] payout details of ${teacherId} did not open (key version ${row.keyVersion})`,
      );
      return { ok: false, reason: "unreadable" };
    }
    await writeAudit(tx, {
      actorId,
      action: "payout_details.revealed",
      subjectType: "user",
      subjectId: teacherId,
      after: { ibanLast4: row.ibanLast4, keyVersion: row.keyVersion },
    });
    return { ok: true, iban };
  });
}
