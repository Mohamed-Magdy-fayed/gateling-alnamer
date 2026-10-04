import "server-only";
import { asc, eq } from "drizzle-orm";
import { writeAudit } from "@/server/audit/repository";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { teacherProfiles, users } from "@/server/db/schema";
import { MAX_TEXT } from "./account";

// Admin review of teacher applications (C1).

export type TeacherApplication = {
  teacherId: string;
  name: string;
  email: string | null;
  note: string | null;
  appliedAt: Date;
};

/** Applications waiting for a decision, oldest first. */
export async function listTeacherApplications(): Promise<TeacherApplication[]> {
  return db()
    .select({
      teacherId: users.id,
      name: users.name,
      email: users.email,
      note: teacherProfiles.applicationNote,
      appliedAt: teacherProfiles.createdAt,
    })
    .from(teacherProfiles)
    .innerJoin(users, eq(users.id, teacherProfiles.userId))
    .where(eq(teacherProfiles.status, "applied"))
    .orderBy(asc(teacherProfiles.createdAt));
}

export type Decision = "approve" | "reject";

export type DecideResult =
  | { ok: true; recipient: { email: string | null; name: string; locale: string | null } }
  | { ok: false; reason: "not_found" | "not_pending" | "reason_required" | "reason_too_long" };

/**
 * Approves or rejects an application. A rejection needs a reason (it is mailed); both write the
 * decision, who and when with the audit row in one transaction. Only an `applied` profile can be
 * decided. The caller queues the email with the returned recipient.
 */
export async function decideTeacherApplication(input: {
  adminId: string;
  teacherId: string;
  decision: Decision;
  reason: string;
}): Promise<DecideResult> {
  const reason = input.reason.trim();
  if (input.decision === "reject" && reason.length === 0)
    return { ok: false, reason: "reason_required" };
  if (reason.length > MAX_TEXT) return { ok: false, reason: "reason_too_long" };
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: teacherProfiles.status,
        email: users.email,
        name: users.name,
        locale: users.locale,
      })
      .from(teacherProfiles)
      .innerJoin(users, eq(users.id, teacherProfiles.userId))
      .where(eq(teacherProfiles.userId, input.teacherId))
      .for("update", { of: teacherProfiles });
    if (!row) return { ok: false, reason: "not_found" } as const;
    if (row.status !== "applied") return { ok: false, reason: "not_pending" } as const;
    const status = input.decision === "approve" ? "approved" : "rejected";
    await tx
      .update(teacherProfiles)
      .set({
        status,
        decisionReason: reason || null,
        decidedAt: clock.now(),
        decidedBy: input.adminId,
      })
      .where(eq(teacherProfiles.userId, input.teacherId));
    await writeAudit(tx, {
      actorId: input.adminId,
      action: `teacher.${status}`,
      subjectType: "user",
      subjectId: input.teacherId,
      before: { status: "applied" },
      after: { status, reason: reason || null },
    });
    return {
      ok: true,
      recipient: { email: row.email, name: row.name, locale: row.locale },
    } as const;
  });
}
