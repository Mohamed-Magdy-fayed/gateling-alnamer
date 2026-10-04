import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";
import type { LocalizedText } from "@/lib/localized-text";
import { writeAudit } from "@/server/audit/repository";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { teacherProfiles, termsVersions } from "@/server/db/schema";

// Teacher terms (C1). The current version is the latest published one; a teacher authors only
// while approved and with that exact version accepted, so a new version asks everyone again.

type Executor = Pick<ReturnType<typeof db>, "select">;

export type TermsVersion = { id: string; body: LocalizedText; isPlaceholder: boolean };

export async function currentTeacherTerms(executor: Executor = db()): Promise<TermsVersion | null> {
  const [row] = await executor
    .select({
      id: termsVersions.id,
      body: termsVersions.body,
      isPlaceholder: termsVersions.isPlaceholder,
    })
    .from(termsVersions)
    .where(and(eq(termsVersions.kind, "teacher"), lte(termsVersions.publishedAt, clock.now())))
    .orderBy(desc(termsVersions.publishedAt))
    .limit(1);
  return row ?? null;
}

/** Approved, and the current terms accepted: the T5 authoring gate. */
export async function canAuthor(teacherId: string): Promise<boolean> {
  const [profile] = await db()
    .select({ status: teacherProfiles.status, accepted: teacherProfiles.termsVersionAccepted })
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, teacherId))
    .limit(1);
  if (profile?.status !== "approved") return false;
  const current = await currentTeacherTerms();
  return current !== null && profile.accepted === current.id;
}

export type AcceptTermsResult =
  | { ok: true }
  | { ok: false; reason: "not_approved" | "stale_version" };

/**
 * Records the acceptance of `versionId`, which must still be the current version (the page may
 * have been open while a new one was published). Audit-logged with the version.
 */
export async function acceptTeacherTerms(
  teacherId: string,
  versionId: string,
): Promise<AcceptTermsResult> {
  return db().transaction(async (tx) => {
    const [profile] = await tx
      .select({ status: teacherProfiles.status })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, teacherId))
      .for("update");
    if (profile?.status !== "approved") return { ok: false, reason: "not_approved" };
    const current = await currentTeacherTerms(tx);
    if (!current || current.id !== versionId) return { ok: false, reason: "stale_version" };
    await tx
      .update(teacherProfiles)
      .set({ termsVersionAccepted: versionId, termsAcceptedAt: clock.now() })
      .where(eq(teacherProfiles.userId, teacherId));
    await writeAudit(tx, {
      actorId: teacherId,
      action: "teacher.terms_accepted",
      subjectType: "user",
      subjectId: teacherId,
      after: { version: versionId },
    });
    return { ok: true };
  });
}
