import "server-only";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { LocalizedText } from "@/lib/localized-text";
import { sampleVisible } from "@/server/catalog/visibility";
import { type DbExecutor, db } from "@/server/db";
import { courseRevisions, courses, entitlements, lessons, sections } from "@/server/db/schema";

export type StudentCourse = {
  courseId: string;
  slug: string;
  title: LocalizedText;
  /** The latest end among the student's entitlements for this course. */
  endsAt: Date;
  /** Live access now: not revoked and not ended. */
  active: boolean;
  /** First lesson in outline order, for "Continue". */
  firstLessonId: string | null;
};

const firstLessonId = sql<string | null>`(
  select ${lessons.id} from ${lessons}
  inner join ${sections} on ${sections.id} = ${lessons.sectionId}
  where ${lessons.courseId} = ${courses.id} and ${lessons.publishedRevisionId} is not null
  order by ${sections.sort}, ${lessons.sort}
  limit 1
)`;

/**
 * The student's courses, one row per course: live access first (soonest end first), then ended
 * or revoked access. Only published courses still visible (sample rows hide with the sample switch).
 */
export async function listStudentCourses(
  studentId: string,
  now: Date,
  executor: DbExecutor = db(),
): Promise<StudentCourse[]> {
  const liveEnd = sql<Date | null>`max(${entitlements.endsAt}) filter (where ${entitlements.revokedAt} is null and ${entitlements.endsAt} > ${now.toISOString()}::timestamptz)`;
  const anyEnd = sql<Date>`max(${entitlements.endsAt})`;
  const rows = await executor
    .select({
      courseId: courses.id,
      slug: courses.slug,
      title: courseRevisions.title,
      liveEnd,
      anyEnd,
      firstLessonId,
    })
    .from(entitlements)
    .innerJoin(courses, eq(courses.id, entitlements.courseId))
    .innerJoin(courseRevisions, eq(courseRevisions.id, courses.publishedRevisionId))
    .where(
      and(
        eq(entitlements.studentId, studentId),
        eq(courses.status, "published"),
        sampleVisible(courses.isSample),
      ),
    )
    .groupBy(courses.id, courses.slug, courseRevisions.title);
  return rows
    .map((row) => ({
      courseId: row.courseId,
      slug: row.slug,
      title: row.title,
      endsAt: new Date(row.liveEnd ?? row.anyEnd),
      active: row.liveEnd !== null,
      firstLessonId: row.firstLessonId,
    }))
    .sort((a, b) =>
      a.active === b.active ? a.endsAt.getTime() - b.endsAt.getTime() : a.active ? -1 : 1,
    );
}

/** For each of `studentIds`, the end of their live access to `courseId` (absent when none). */
export async function activeAccessEnds(
  studentIds: readonly string[],
  courseId: string,
  now: Date,
  executor: DbExecutor = db(),
): Promise<Map<string, Date>> {
  if (studentIds.length === 0) return new Map();
  const rows = await executor
    .select({
      studentId: entitlements.studentId,
      endsAt: sql<Date>`max(${entitlements.endsAt})`,
    })
    .from(entitlements)
    .where(
      and(
        inArray(entitlements.studentId, [...studentIds]),
        eq(entitlements.courseId, courseId),
        isNull(entitlements.revokedAt),
        gt(entitlements.endsAt, now),
      ),
    )
    .groupBy(entitlements.studentId);
  return new Map(rows.map((row) => [row.studentId, new Date(row.endsAt)]));
}

export type ChildCourse = { courseId: string; title: LocalizedText; endsAt: Date };

/** Live courses per child, for the parent's child cards (titles and end dates only, no lesson links). */
export async function listChildrenCourses(
  childIds: readonly string[],
  now: Date,
  executor: DbExecutor = db(),
): Promise<Map<string, ChildCourse[]>> {
  if (childIds.length === 0) return new Map();
  const rows = await executor
    .select({
      studentId: entitlements.studentId,
      courseId: courses.id,
      title: courseRevisions.title,
      endsAt: sql<Date>`max(${entitlements.endsAt})`,
    })
    .from(entitlements)
    .innerJoin(courses, eq(courses.id, entitlements.courseId))
    .innerJoin(courseRevisions, eq(courseRevisions.id, courses.publishedRevisionId))
    .where(
      and(
        inArray(entitlements.studentId, [...childIds]),
        isNull(entitlements.revokedAt),
        gt(entitlements.endsAt, now),
        eq(courses.status, "published"),
        sampleVisible(courses.isSample),
      ),
    )
    .groupBy(entitlements.studentId, courses.id, courseRevisions.title)
    .orderBy(asc(sql`max(${entitlements.endsAt})`));
  const byChild = new Map<string, ChildCourse[]>();
  for (const row of rows) {
    const list = byChild.get(row.studentId) ?? [];
    byChild.set(row.studentId, [
      ...list,
      { courseId: row.courseId, title: row.title, endsAt: new Date(row.endsAt) },
    ]);
  }
  return byChild;
}
