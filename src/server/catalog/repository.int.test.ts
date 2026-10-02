import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import {
  getPublishedCourseBySlug,
  getPublishedLesson,
  listCoursesForDashboard,
  listPublishedCourses,
} from "./repository";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const conn = drizzle(client, { schema });

const SAMPLE_SLUG = "math-grade-12-calculus";
const TEACHER_EMAIL = "int-teacher@example.test";

afterEach(async () => {
  await conn.update(schema.platformSettings).set({ sampleHiddenAt: null });
  await conn.delete(schema.courses).where(eq(schema.courses.slug, "int-draft"));
  await conn.delete(schema.courses).where(eq(schema.courses.slug, "int-real"));
  await conn
    .delete(schema.teacherProfiles)
    .where(
      eq(
        schema.teacherProfiles.userId,
        conn
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, TEACHER_EMAIL))
          .limit(1),
      ),
    );
  await conn.delete(schema.users).where(eq(schema.users.email, TEACHER_EMAIL));
});

afterAll(async () => {
  await client.end();
});

type TeacherStatus = (typeof schema.teacherStatus.enumValues)[number];

async function insertRealCourse(
  status: "draft" | "published",
  slug: string,
  teacherStatus: TeacherStatus = "approved",
): Promise<{ lessonId: string }> {
  const teacherId = randomUUID();
  const courseId = randomUUID();
  const revisionId = randomUUID();
  const sectionId = randomUUID();
  const sectionRevisionId = randomUUID();
  const lessonId = randomUUID();
  const lessonRevisionId = randomUUID();
  await conn.insert(schema.users).values({
    id: teacherId,
    name: "Real Teacher",
    email: TEACHER_EMAIL,
    role: "teacher",
  });
  await conn.insert(schema.teacherProfiles).values({
    userId: teacherId,
    publicName: { en: "Real Teacher" },
    bio: { en: "Bio" },
    status: teacherStatus,
  });
  await conn.insert(schema.courses).values({ id: courseId, slug, teacherId, status });
  await conn.insert(schema.courseRevisions).values({
    id: revisionId,
    courseId,
    title: { en: "Real course" },
    description: { en: "Desc" },
    priceMinor: 1000,
    accessKind: "duration_days",
    accessDays: 30,
  });
  await conn
    .update(schema.courses)
    .set({ publishedRevisionId: revisionId })
    .where(eq(schema.courses.id, courseId));
  await conn.insert(schema.sections).values({ id: sectionId, courseId, sort: 1 });
  await conn
    .insert(schema.sectionRevisions)
    .values({ id: sectionRevisionId, sectionId, title: { en: "Section" } });
  await conn
    .update(schema.sections)
    .set({ publishedRevisionId: sectionRevisionId })
    .where(eq(schema.sections.id, sectionId));
  await conn
    .insert(schema.lessons)
    .values({ id: lessonId, courseId, sectionId, kind: "video", sort: 1 });
  await conn
    .insert(schema.lessonRevisions)
    .values({ id: lessonRevisionId, lessonId, title: { en: "Lesson" } });
  await conn
    .update(schema.lessons)
    .set({ publishedRevisionId: lessonRevisionId })
    .where(eq(schema.lessons.id, lessonId));
  return { lessonId };
}

describe("catalogue repository", () => {
  it("lists the four sample courses", async () => {
    const courses = await listPublishedCourses(conn);
    expect(courses).toHaveLength(4);
    expect(courses.every((course) => course.teacher.name.en)).toBe(true);
    expect(courses[0]?.categories.length).toBeGreaterThan(0);
  });

  it("lists published courses only", async () => {
    await insertRealCourse("draft", "int-draft");
    const slugs = (await listPublishedCourses(conn)).map((course) => course.slug);
    expect(slugs).not.toContain("int-draft");
    expect(await getPublishedCourseBySlug("int-draft", conn)).toBeNull();
    const dashboard = await listCoursesForDashboard(conn);
    expect(dashboard.map((course) => course.slug)).not.toContain("int-draft");
  });

  it("keeps a published real course when samples are hidden", async () => {
    await insertRealCourse("published", "int-real");
    await conn.update(schema.platformSettings).set({ sampleHiddenAt: new Date() });
    const slugs = (await listPublishedCourses(conn)).map((course) => course.slug);
    expect(slugs).toEqual(["int-real"]);
  });

  it("hides sample courses and teachers once sample_hidden_at is set", async () => {
    await conn.update(schema.platformSettings).set({ sampleHiddenAt: new Date() });
    expect(await listPublishedCourses(conn)).toEqual([]);
    expect(await getPublishedCourseBySlug(SAMPLE_SLUG, conn)).toBeNull();
    expect(await listCoursesForDashboard(conn)).toEqual([]);
  });

  it("returns a course with categories, teacher and ordered sections and lessons", async () => {
    const course = await getPublishedCourseBySlug(SAMPLE_SLUG, conn);
    if (!course) throw new Error("sample course missing");
    expect(course.teacher.name.en).toBeTruthy();
    expect(new Set(course.categories.map((category) => category.type))).toEqual(
      new Set(["curriculum", "grade", "subject"]),
    );
    expect(course.sections.length).toBeGreaterThan(1);
    const sectionRows = await client`
      select id from sections where course_id = ${course.id} order by sort`;
    expect(course.sections.map((section) => section.id)).toEqual(
      sectionRows.map((row) => row.id as string),
    );
    for (const section of course.sections) {
      const lessonRows = await client`
        select id from lessons where section_id = ${section.id} order by sort`;
      expect(section.lessons.map((lesson) => lesson.id)).toEqual(
        lessonRows.map((row) => row.id as string),
      );
    }
  });

  it("returns a lesson without body or media keys", async () => {
    const course = await getPublishedCourseBySlug(SAMPLE_SLUG, conn);
    const lesson = course?.sections[0]?.lessons[0];
    if (!lesson) throw new Error("sample lesson missing");
    const view = await getPublishedLesson(lesson.id, conn);
    expect(view).toMatchObject({ id: lesson.id, kind: lesson.kind });
    expect(view?.course.slug).toBe(SAMPLE_SLUG);
    expect(view?.sectionTitle.en).toBeTruthy();
    const keys = [...Object.keys(view ?? {}), ...Object.keys(view?.course ?? {})];
    for (const forbidden of ["body", "videoAssetId", "fileAssetId", "storageKey", "providerId"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("hides lessons of hidden samples and unknown ids", async () => {
    const course = await getPublishedCourseBySlug(SAMPLE_SLUG, conn);
    const lessonId = course?.sections[0]?.lessons[0]?.id ?? "";
    await conn.update(schema.platformSettings).set({ sampleHiddenAt: new Date() });
    expect(await getPublishedLesson(lessonId, conn)).toBeNull();
    expect(await getPublishedLesson(randomUUID(), conn)).toBeNull();
  });

  it("serves an approved real teacher's lessons", async () => {
    const { lessonId } = await insertRealCourse("published", "int-real", "approved");
    expect((await listPublishedCourses(conn)).map((course) => course.slug)).toContain("int-real");
    expect(await getPublishedLesson(lessonId, conn)).not.toBeNull();
  });

  it.each(["suspended", "rejected", "applied"] as const)(
    "hides a published course whose teacher is %s",
    async (teacherStatus) => {
      const { lessonId } = await insertRealCourse("published", "int-real", teacherStatus);
      expect((await listPublishedCourses(conn)).map((course) => course.slug)).not.toContain(
        "int-real",
      );
      expect(await getPublishedCourseBySlug("int-real", conn)).toBeNull();
      expect(await getPublishedLesson(lessonId, conn)).toBeNull();
      expect((await listCoursesForDashboard(conn)).map((course) => course.slug)).not.toContain(
        "int-real",
      );
    },
  );

  it("bounds both list functions with a limit", async () => {
    expect(await listPublishedCourses(conn, { limit: 2 })).toHaveLength(2);
    expect(await listCoursesForDashboard(conn, { limit: 3 })).toHaveLength(3);
    expect(await listPublishedCourses(conn)).toHaveLength(4);
  });

  it("returns dashboard rows with lesson counts", async () => {
    const rows = await listCoursesForDashboard(conn);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.lessonCount > 0 && row.firstLessonId)).toBe(true);
    const sample = await getPublishedCourseBySlug(SAMPLE_SLUG, conn);
    const row = rows.find((candidate) => candidate.slug === SAMPLE_SLUG);
    const lessonList = sample?.sections.flatMap((section) => section.lessons) ?? [];
    expect(row?.lessonCount).toBe(lessonList.length);
    expect(row?.firstLessonId).toBe(lessonList[0]?.id);
  });
});
