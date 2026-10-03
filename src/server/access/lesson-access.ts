import "server-only";
import { and, eq } from "drizzle-orm";
import { sampleVisible } from "@/server/catalog/visibility";
import { db } from "@/server/db";
import { courses, entitlements, lessonRevisions, lessons, type UserRole } from "@/server/db/schema";
import { assertActiveDevice } from "@/server/devices/service";

/**
 * Proof that `getLessonAccess` allowed something. The brand symbol is declared, never exported,
 * and `grant()` below is the only code that builds one, so no other module can forge it
 * (`lesson-access.type.test.ts` proves an object literal is rejected).
 */
declare const accessBrand: unique symbol;

export type AccessMode = "preview" | "entitled" | "staff_preview";

export type AccessGranted = {
  readonly [accessBrand]: true;
  readonly lessonId: string;
  /** Null for an anonymous free preview. */
  readonly userId: string | null;
  readonly mode: AccessMode;
};

function grant(lessonId: string, userId: string | null, mode: AccessMode): AccessGranted {
  return { lessonId, userId, mode } as AccessGranted;
}

export type AccessDenialReason =
  | "not_found"
  | "not_published"
  | "parent"
  | "no_entitlement"
  | "expired"
  | "revoked"
  | "device_inactive"
  | "anonymous";

export type LessonAccess =
  | { allowed: true; grant: AccessGranted }
  | { allowed: false; reason: AccessDenialReason };

/** The caller as the access decision sees it: the session's own device id, never read from cookies here. */
export type AccessUser = { id: string; role: UserRole; deviceId: string | null };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const deny = (reason: AccessDenialReason): LessonAccess => ({ allowed: false, reason });

async function loadLesson(lessonId: string) {
  const [row] = await db()
    .select({
      courseId: courses.id,
      teacherId: courses.teacherId,
      courseStatus: courses.status,
      coursePublishedRevisionId: courses.publishedRevisionId,
      lessonPublishedRevisionId: lessons.publishedRevisionId,
      isFreePreview: lessonRevisions.isFreePreview,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .leftJoin(lessonRevisions, eq(lessonRevisions.id, lessons.publishedRevisionId))
    .where(
      and(
        eq(lessons.id, lessonId),
        sampleVisible(lessons.isSample),
        sampleVisible(courses.isSample),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function studentAccess(
  user: AccessUser,
  lessonId: string,
  courseId: string,
  now: Date,
): Promise<LessonAccess> {
  const rows = await db()
    .select({
      startsAt: entitlements.startsAt,
      endsAt: entitlements.endsAt,
      revokedAt: entitlements.revokedAt,
    })
    .from(entitlements)
    .where(and(eq(entitlements.studentId, user.id), eq(entitlements.courseId, courseId)));

  const t = now.getTime();
  const active = rows.some(
    (row) => !row.revokedAt && row.startsAt.getTime() <= t && t < row.endsAt.getTime(),
  );
  if (!active) {
    if (rows.some((row) => !row.revokedAt && row.endsAt.getTime() <= t)) return deny("expired");
    if (rows.some((row) => row.revokedAt)) return deny("revoked");
    return deny("no_entitlement");
  }

  const device = await assertActiveDevice({ role: user.role, deviceId: user.deviceId });
  if (!device.ok) return deny("device_inactive");
  return { allowed: true, grant: grant(lessonId, user.id, "entitled") };
}

/**
 * The single access decision for a lesson (invariant 1). Allowed when the lesson is a published
 * free preview; or the user is a student with a live entitlement on an active device; or the user
 * is the course's teacher, a reviewer or an admin (preview). Parents never get playback.
 */
export async function getLessonAccess(
  user: AccessUser | null,
  lessonId: string,
  now: Date,
): Promise<LessonAccess> {
  if (!UUID_PATTERN.test(lessonId)) return deny("not_found");
  const lesson = await loadLesson(lessonId);
  if (!lesson) return deny("not_found");
  const published =
    lesson.courseStatus === "published" &&
    lesson.coursePublishedRevisionId !== null &&
    lesson.lessonPublishedRevisionId !== null;
  if (!published) return deny("not_published");

  if (user?.role === "parent") return deny("parent");
  if (lesson.isFreePreview)
    return { allowed: true, grant: grant(lessonId, user?.id ?? null, "preview") };
  if (!user) return deny("anonymous");

  if (user.role === "admin" || user.role === "reviewer") {
    return { allowed: true, grant: grant(lessonId, user.id, "staff_preview") };
  }
  if (user.role === "teacher") {
    return user.id === lesson.teacherId
      ? { allowed: true, grant: grant(lessonId, user.id, "staff_preview") }
      : deny("no_entitlement");
  }
  return studentAccess(user, lessonId, lesson.courseId, now);
}
