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

async function insertRealCourse(status: "draft" | "published", slug: string) {
  const teacherId = randomUUID();
  const courseId = randomUUID();
  const revisionId = randomUUID();
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
    status: "approved",
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

  it("returns dashboard rows with lesson counts", async () => {
    const rows = await listCoursesForDashboard(conn);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.lessonCount > 0 && row.firstLessonId)).toBe(true);
  });
});
