import "server-only";
import { and, eq } from "drizzle-orm";
import type { LocalizedText } from "@/lib/localized-text";
import { db } from "@/server/db";
import { teacherProfiles, users } from "@/server/db/schema";
import { listPublishedCoursesByTeacher } from "../repository";
import type { CourseSummary } from "../types";
import { currentTeacherTerms, type TermsVersion } from "./terms";

export type PublicTeacherProfile = {
  publicName: LocalizedText;
  bio: LocalizedText;
  isSample: boolean;
  courses: CourseSummary[];
};

/**
 * The public teacher page (C1): approved teachers only (anyone else is "not found"), by their
 * public number. No email, status, number or account detail leaves this function.
 */
export async function publicTeacherProfile(
  publicNumber: string,
): Promise<PublicTeacherProfile | null> {
  if (!/^[A-Z0-9-]{1,32}$/.test(publicNumber)) return null;
  const [row] = await db()
    .select({
      teacherId: teacherProfiles.userId,
      publicName: teacherProfiles.publicName,
      bio: teacherProfiles.bio,
      isSample: teacherProfiles.isSample,
    })
    .from(teacherProfiles)
    .innerJoin(users, eq(users.id, teacherProfiles.userId))
    .where(
      and(
        eq(users.publicNumber, publicNumber),
        eq(teacherProfiles.status, "approved"),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    publicName: row.publicName,
    bio: row.bio,
    isSample: row.isSample,
    courses: await listPublishedCoursesByTeacher(row.teacherId),
  };
}

export type TeacherOnboardingState = {
  status: "applied" | "approved" | "rejected" | "suspended";
  decisionReason: string | null;
  publicNumber: string | null;
  /** The current terms when an approved teacher has not accepted them yet; null otherwise. */
  termsToAccept: TermsVersion | null;
};

/** What the teacher dashboard shows before authoring (C1); null when the user has no profile. */
export async function teacherOnboardingState(
  teacherId: string,
): Promise<TeacherOnboardingState | null> {
  const [row] = await db()
    .select({
      status: teacherProfiles.status,
      decisionReason: teacherProfiles.decisionReason,
      accepted: teacherProfiles.termsVersionAccepted,
      publicNumber: users.publicNumber,
    })
    .from(teacherProfiles)
    .innerJoin(users, eq(users.id, teacherProfiles.userId))
    .where(eq(teacherProfiles.userId, teacherId))
    .limit(1);
  if (!row) return null;
  const terms = row.status === "approved" ? await currentTeacherTerms() : null;
  return {
    status: row.status,
    decisionReason: row.decisionReason,
    publicNumber: row.publicNumber,
    termsToAccept: terms && terms.id !== row.accepted ? terms : null,
  };
}
