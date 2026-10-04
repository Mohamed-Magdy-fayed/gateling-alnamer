import "server-only";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { type DbExecutor, db } from "@/server/db";
import {
  categories,
  courseCategories,
  courseRevisions,
  courses,
  lessonRevisions,
  lessons,
  sectionRevisions,
  sections,
  teacherProfiles,
  users,
} from "@/server/db/schema";
import type {
  CatalogCategory,
  CatalogSection,
  CourseAccess,
  CourseDetail,
  CourseSummary,
  DashboardCourse,
  LessonView,
} from "./types";
import { sampleVisible } from "./visibility";

// The only module that reads content tables (guarded by content-access.test.ts).

const courseSummaryColumns = {
  id: courses.id,
  slug: courses.slug,
  title: courseRevisions.title,
  description: courseRevisions.description,
  priceMinor: courseRevisions.priceMinor,
  accessKind: courseRevisions.accessKind,
  accessEndAt: courseRevisions.accessEndAt,
  accessDays: courseRevisions.accessDays,
  estimatedHours: courseRevisions.estimatedHours,
  teacherId: teacherProfiles.userId,
  teacherName: teacherProfiles.publicName,
  teacherBio: teacherProfiles.bio,
  // A profile exists only for an active account; otherwise no link (it would be a 404).
  teacherNumber: sql<
    string | null
  >`case when ${users.status} = 'active' then ${users.publicNumber} end`,
};

function toAccess(row: {
  accessKind: "fixed_end" | "duration_days";
  accessEndAt: Date | null;
  accessDays: number | null;
}): CourseAccess {
  if (row.accessKind === "fixed_end" && row.accessEndAt) {
    return { kind: "fixed_end", endAt: row.accessEndAt };
  }
  if (row.accessKind === "duration_days" && row.accessDays) {
    return { kind: "duration_days", days: row.accessDays };
  }
  throw new Error("course revision has inconsistent access fields");
}

/** Published course rows: published revision only, sample filter on course and teacher. */
function publishedCourseQuery(executor: DbExecutor) {
  return executor
    .select(courseSummaryColumns)
    .from(courses)
    .innerJoin(courseRevisions, eq(courseRevisions.id, courses.publishedRevisionId))
    .innerJoin(users, eq(users.id, courses.teacherId))
    .innerJoin(teacherProfiles, eq(teacherProfiles.userId, courses.teacherId));
}

/** Default and ceiling for list reads; callers may ask for fewer. */
const DEFAULT_LIST_LIMIT = 100;

export type ListOptions = { limit?: number };

function listLimit(options: ListOptions): number {
  const requested = options.limit ?? DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), DEFAULT_LIST_LIMIT);
}

const publishedVisible = and(
  eq(courses.status, "published"),
  eq(teacherProfiles.status, "approved"),
  sampleVisible(courses.isSample),
  sampleVisible(users.isSample),
);

async function categoriesByCourse(
  executor: DbExecutor,
  courseIds: string[],
): Promise<Map<string, CatalogCategory[]>> {
  const result = new Map<string, CatalogCategory[]>();
  if (courseIds.length === 0) return result;
  const rows = await executor
    .select({
      courseId: courseCategories.courseId,
      id: categories.id,
      type: categories.type,
      slug: categories.slug,
      nameAr: categories.nameAr,
      nameEn: categories.nameEn,
    })
    .from(courseCategories)
    .innerJoin(categories, eq(categories.id, courseCategories.categoryId))
    .where(inArray(courseCategories.courseId, courseIds))
    .orderBy(asc(categories.type), asc(categories.sort), asc(categories.slug));
  for (const row of rows) {
    const list = result.get(row.courseId) ?? [];
    list.push({
      id: row.id,
      type: row.type,
      slug: row.slug,
      name: { ar: row.nameAr, en: row.nameEn },
    });
    result.set(row.courseId, list);
  }
  return result;
}

type SummaryRow = Awaited<ReturnType<typeof publishedCourseQuery>>[number];

function toSummary(row: SummaryRow, cats: CatalogCategory[]): CourseSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    priceMinor: row.priceMinor,
    access: toAccess(row),
    estimatedHours: row.estimatedHours,
    teacher: {
      id: row.teacherId,
      name: row.teacherName,
      bio: row.teacherBio,
      publicNumber: row.teacherNumber,
    },
    categories: cats,
  };
}

export async function listPublishedCourses(
  executor: DbExecutor = db(),
  options: ListOptions = {},
): Promise<CourseSummary[]> {
  const rows = await publishedCourseQuery(executor)
    .where(publishedVisible)
    .orderBy(asc(courses.createdAt), asc(courses.slug))
    .limit(listLimit(options));
  const cats = await categoriesByCourse(
    executor,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toSummary(row, cats.get(row.id) ?? []));
}

/** A teacher's published courses (the public teacher profile, C1). */
export async function listPublishedCoursesByTeacher(
  teacherId: string,
  executor: DbExecutor = db(),
): Promise<CourseSummary[]> {
  const rows = await publishedCourseQuery(executor)
    .where(and(publishedVisible, eq(courses.teacherId, teacherId)))
    .orderBy(asc(courses.createdAt), asc(courses.slug))
    .limit(listLimit({}));
  const cats = await categoriesByCourse(
    executor,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toSummary(row, cats.get(row.id) ?? []));
}

export async function getPublishedCourseBySlug(
  slug: string,
  executor: DbExecutor = db(),
): Promise<CourseDetail | null> {
  const [row] = await publishedCourseQuery(executor).where(
    and(publishedVisible, eq(courses.slug, slug)),
  );
  if (!row) return null;
  const cats = await categoriesByCourse(executor, [row.id]);

  const sectionRows = await executor
    .select({ id: sections.id, title: sectionRevisions.title })
    .from(sections)
    .innerJoin(sectionRevisions, eq(sectionRevisions.id, sections.publishedRevisionId))
    .where(eq(sections.courseId, row.id))
    .orderBy(asc(sections.sort));
  const lessonRows = await executor
    .select({
      id: lessons.id,
      sectionId: lessons.sectionId,
      kind: lessons.kind,
      title: lessonRevisions.title,
      isFreePreview: lessonRevisions.isFreePreview,
      durationMinutes: lessonRevisions.durationMinutes,
    })
    .from(lessons)
    .innerJoin(lessonRevisions, eq(lessonRevisions.id, lessons.publishedRevisionId))
    .innerJoin(sections, eq(sections.id, lessons.sectionId))
    .where(eq(lessons.courseId, row.id))
    .orderBy(asc(sections.sort), asc(lessons.sort));

  const detailSections: CatalogSection[] = sectionRows.map((section) => ({
    id: section.id,
    title: section.title,
    lessons: lessonRows
      .filter((lesson) => lesson.sectionId === section.id)
      .map((lesson) => ({
        id: lesson.id,
        kind: lesson.kind,
        title: lesson.title,
        isFreePreview: lesson.isFreePreview,
        durationMinutes: lesson.durationMinutes,
      })),
  }));
  return { ...toSummary(row, cats.get(row.id) ?? []), sections: detailSections };
}

/** Learn-page metadata. Deliberately no body and no media keys. */
export async function getPublishedLesson(
  lessonId: string,
  executor: DbExecutor = db(),
): Promise<LessonView | null> {
  const [row] = await executor
    .select({
      id: lessons.id,
      kind: lessons.kind,
      title: lessonRevisions.title,
      isFreePreview: lessonRevisions.isFreePreview,
      durationMinutes: lessonRevisions.durationMinutes,
      courseSlug: courses.slug,
      courseTitle: courseRevisions.title,
      sectionTitle: sectionRevisions.title,
    })
    .from(lessons)
    .innerJoin(lessonRevisions, eq(lessonRevisions.id, lessons.publishedRevisionId))
    .innerJoin(sections, eq(sections.id, lessons.sectionId))
    .innerJoin(sectionRevisions, eq(sectionRevisions.id, sections.publishedRevisionId))
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .innerJoin(courseRevisions, eq(courseRevisions.id, courses.publishedRevisionId))
    .innerJoin(users, eq(users.id, courses.teacherId))
    .innerJoin(teacherProfiles, eq(teacherProfiles.userId, courses.teacherId))
    .where(and(eq(lessons.id, lessonId), publishedVisible, sampleVisible(lessons.isSample)));
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    isFreePreview: row.isFreePreview,
    durationMinutes: row.durationMinutes,
    course: { slug: row.courseSlug, title: row.courseTitle },
    sectionTitle: row.sectionTitle,
  };
}

export async function listCoursesForDashboard(
  executor: DbExecutor = db(),
  options: ListOptions = {},
): Promise<DashboardCourse[]> {
  const rows = await listPublishedCourses(executor, options);
  if (rows.length === 0) return [];
  const firstLessonId = sql<string>`(array_agg(${lessons.id} order by ${sections.sort}, ${lessons.sort}))[1]`;
  const lessonStats = await executor
    .select({ courseId: lessons.courseId, lessonCount: count(), firstLessonId })
    .from(lessons)
    .innerJoin(sections, eq(sections.id, lessons.sectionId))
    .where(
      and(
        inArray(
          lessons.courseId,
          rows.map((row) => row.id),
        ),
        sampleVisible(lessons.isSample),
      ),
    )
    .groupBy(lessons.courseId);
  const statsByCourse = new Map(lessonStats.map((stat) => [stat.courseId, stat]));
  return rows.map((row) => {
    const stat = statsByCourse.get(row.id);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      teacher: row.teacher.name,
      priceMinor: row.priceMinor,
      lessonCount: stat?.lessonCount ?? 0,
      firstLessonId: stat?.firstLessonId ?? null,
    };
  });
}
