import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import * as schema from "@/server/db/schema";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example", APP_MODE: "demo" }),
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const dbSchema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  const conn = drizzle(client, { schema: dbSchema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => import("@/server/orders/test-fixtures").TestConn;
  closeTestDb: () => Promise<void>;
};
const conn = dbModule.db();
const {
  createDraftCourse,
  getTeacherCourse,
  listPendingReview,
  listTeacherCourses,
  publishCourse,
  submitForReview,
} = await import("./authoring");
const { getPublishedCourseBySlug, getPublishedLesson } = await import("./repository");
const { createUser } = await import("@/server/orders/test-fixtures");

const NOW = new Date("2030-05-01T09:00:00.000Z");
const input = {
  titleAr: "مقدمة في الجبر",
  titleEn: "Intro to algebra",
  descriptionAr: "دورة قصيرة.",
  price: 150,
  accessDays: 90,
  lessonTitleAr: "الدرس الأول",
  freePreview: true,
};

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

async function teacher(status: "approved" | "applied" = "approved") {
  const user = await createUser(conn, { role: "teacher" });
  await conn.insert(schema.teacherProfiles).values({
    userId: user.id,
    publicName: { ar: "معلم", en: "Teacher" },
    bio: { ar: "نبذة", en: "Bio" },
    status,
  });
  return user;
}

describe("course authoring", () => {
  it("an approved teacher creates a draft with pending revisions only", async () => {
    const author = await teacher();
    const result = await createDraftCourse(author.id, input);
    if (!result.ok) throw new Error(result.reason);
    const [course] = await conn
      .select()
      .from(schema.courses)
      .where(eq(schema.courses.id, result.courseId));
    expect(course).toMatchObject({ status: "draft", publishedRevisionId: null, isSample: false });
    expect(course?.pendingRevisionId).not.toBeNull();
    expect(course?.slug).toMatch(/^c-[0-9a-z]{8}$/);
    const detail = await getTeacherCourse(author.id, result.courseId);
    expect(detail).toMatchObject({ priceMinor: 15_000, accessDays: 90, status: "draft" });
    expect((await listTeacherCourses(author.id)).map((row) => row.id)).toEqual([result.courseId]);
  });

  it("refuses a teacher who is not approved", async () => {
    const applicant = await teacher("applied");
    expect(await createDraftCourse(applicant.id, input)).toEqual({
      ok: false,
      reason: "not_approved",
    });
  });

  it("a teacher can only see and submit their own courses", async () => {
    const author = await teacher();
    const other = await teacher();
    const created = await createDraftCourse(author.id, input);
    if (!created.ok) throw new Error("create failed");
    expect(await getTeacherCourse(other.id, created.courseId)).toBeNull();
    expect(await submitForReview(other.id, created.courseId)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await submitForReview(author.id, created.courseId)).toEqual({ ok: true });
    expect(await submitForReview(author.id, created.courseId)).toEqual({
      ok: false,
      reason: "not_draft",
    });
  });

  it("publishing an in-review course makes it and its lesson public, with an audit row", async () => {
    const author = await teacher();
    const admin = await createUser(conn, { role: "admin" });
    const created = await createDraftCourse(author.id, input);
    if (!created.ok) throw new Error("create failed");
    expect(await publishCourse(admin.id, created.courseId)).toEqual({
      ok: false,
      reason: "not_in_review",
    });
    await submitForReview(author.id, created.courseId);
    expect((await listPendingReview()).some((row) => row.id === created.courseId)).toBe(true);

    expect(await publishCourse(admin.id, created.courseId)).toEqual({ ok: true });
    expect(await publishCourse(admin.id, created.courseId)).toEqual({
      ok: false,
      reason: "not_in_review",
    });

    const detail = await getTeacherCourse(author.id, created.courseId);
    if (!detail) throw new Error("no detail");
    const published = await getPublishedCourseBySlug(detail.slug);
    expect(published?.id).toBe(created.courseId);
    const lessonId = published?.sections[0]?.lessons[0]?.id;
    expect(lessonId).toBeTruthy();
    expect(await getPublishedLesson(lessonId ?? "")).not.toBeNull();
    const audit = await conn
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "course.publish"),
          eq(schema.auditLog.subjectId, created.courseId),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(admin.id);
  });
});
