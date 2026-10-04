import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { LocalizedText } from "@/lib/localized-text";
import { writeAudit } from "@/server/audit/repository";
import { type AbuseDeps, guardDraftCourse } from "@/server/auth/abuse";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import {
  courseRevisions,
  courses,
  lessonRevisions,
  lessons,
  sectionRevisions,
  sections,
  teacherProfiles,
} from "@/server/db/schema";
import { type DraftCourseInput, priceToMinor } from "./authoring-input";

// Course authoring (T5). Content tables are written only here and in the catalogue repository.

type Database = ReturnType<typeof db>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const SLUG_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const SLUG_ATTEMPTS = 4;
const FIRST_SECTION_TITLE: LocalizedText = { ar: "القسم 1", en: "Section 1" };

function newSlug(): string {
  const bytes = randomBytes(8);
  let out = "c-";
  for (const byte of bytes) out += SLUG_ALPHABET.charAt(byte & 31);
  return out;
}

const localized = (ar: string, en = ""): LocalizedText => (en ? { ar, en } : { ar });

export type CreateResult =
  | { ok: true; courseId: string }
  | { ok: false; reason: "not_approved" | "rate_limited" };

async function isApprovedTeacher(teacherId: string): Promise<boolean> {
  const [row] = await db()
    .select({ status: teacherProfiles.status })
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, teacherId))
    .limit(1);
  return row?.status === "approved";
}

async function insertDraft(tx: Tx, teacherId: string, input: DraftCourseInput): Promise<string> {
  const courseId = uuidv7();
  const revisionId = uuidv7();
  const sectionId = uuidv7();
  const sectionRevisionId = uuidv7();
  const lessonId = uuidv7();
  const lessonRevisionId = uuidv7();
  await tx.insert(courses).values({ id: courseId, slug: newSlug(), teacherId, status: "draft" });
  await tx.insert(courseRevisions).values({
    id: revisionId,
    courseId,
    title: localized(input.titleAr, input.titleEn),
    description: localized(input.descriptionAr),
    priceMinor: priceToMinor(input.price),
    accessKind: "duration_days",
    accessDays: input.accessDays,
    createdBy: teacherId,
  });
  await tx.update(courses).set({ pendingRevisionId: revisionId }).where(eq(courses.id, courseId));
  await tx.insert(sections).values({ id: sectionId, courseId, sort: 1 });
  await tx
    .insert(sectionRevisions)
    .values({ id: sectionRevisionId, sectionId, title: FIRST_SECTION_TITLE });
  await tx
    .update(sections)
    .set({ pendingRevisionId: sectionRevisionId })
    .where(eq(sections.id, sectionId));
  await tx.insert(lessons).values({ id: lessonId, courseId, sectionId, kind: "video", sort: 1 });
  await tx.insert(lessonRevisions).values({
    id: lessonRevisionId,
    lessonId,
    title: localized(input.lessonTitleAr),
    isFreePreview: input.freePreview,
  });
  await tx
    .update(lessons)
    .set({ pendingRevisionId: lessonRevisionId })
    .where(eq(lessons.id, lessonId));
  return courseId;
}

/** A new draft course with one section and one lesson, by an approved teacher. */
export async function createDraftCourse(
  teacherId: string,
  input: DraftCourseInput,
  deps: AbuseDeps = {},
): Promise<CreateResult> {
  if (!(await isApprovedTeacher(teacherId))) return { ok: false, reason: "not_approved" };
  const guard = await guardDraftCourse({ userId: teacherId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "rate_limited" };
  for (let attempt = 1; ; attempt++) {
    try {
      const courseId = await db().transaction((tx) => insertDraft(tx, teacherId, input));
      return { ok: true, courseId };
    } catch (error) {
      // A slug clash: try another slug.
      if (!isUniqueViolation(error) || attempt >= SLUG_ATTEMPTS) throw error;
    }
  }
}

export type TeacherCourseRow = {
  id: string;
  slug: string;
  title: LocalizedText;
  status: "draft" | "in_review" | "published" | "hidden" | "archived";
  updatedAt: Date;
};

/** The teacher's own courses, newest first (titles from the latest revision). */
export async function listTeacherCourses(teacherId: string): Promise<TeacherCourseRow[]> {
  const rows = await db()
    .select({
      id: courses.id,
      slug: courses.slug,
      status: courses.status,
      updatedAt: courses.updatedAt,
      pendingTitle: courseRevisions.title,
    })
    .from(courses)
    .innerJoin(courseRevisions, eq(courseRevisions.id, courses.pendingRevisionId))
    .where(eq(courses.teacherId, teacherId))
    .orderBy(desc(courses.createdAt));
  const published = await db()
    .select({
      id: courses.id,
      slug: courses.slug,
      status: courses.status,
      updatedAt: courses.updatedAt,
      title: courseRevisions.title,
    })
    .from(courses)
    .innerJoin(courseRevisions, eq(courseRevisions.id, courses.publishedRevisionId))
    .where(and(eq(courses.teacherId, teacherId), isNotNull(courses.publishedRevisionId)))
    .orderBy(desc(courses.createdAt));
  const byId = new Map<string, TeacherCourseRow>();
  for (const row of published) byId.set(row.id, row);
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      slug: row.slug,
      status: row.status,
      updatedAt: row.updatedAt,
      title: row.pendingTitle,
    });
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export type TeacherCourseDetail = {
  id: string;
  slug: string;
  status: TeacherCourseRow["status"];
  title: LocalizedText;
  description: LocalizedText;
  priceMinor: number;
  accessDays: number | null;
  lessonTitle: LocalizedText | null;
  freePreview: boolean;
};

/** One of the teacher's own courses (the pending revision, or the published one); null otherwise. */
export async function getTeacherCourse(
  teacherId: string,
  courseId: string,
): Promise<TeacherCourseDetail | null> {
  const [course] = await db()
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.teacherId, teacherId)))
    .limit(1);
  if (!course) return null;
  const revisionId = course.pendingRevisionId ?? course.publishedRevisionId;
  if (!revisionId) return null;
  const [revision] = await db()
    .select()
    .from(courseRevisions)
    .where(eq(courseRevisions.id, revisionId))
    .limit(1);
  if (!revision) return null;
  const [lesson] = await db()
    .select({ title: lessonRevisions.title, freePreview: lessonRevisions.isFreePreview })
    .from(lessons)
    .innerJoin(lessonRevisions, eq(lessonRevisions.id, lessons.pendingRevisionId))
    .where(eq(lessons.courseId, courseId))
    .orderBy(lessons.sort)
    .limit(1);
  const [publishedLesson] = lesson
    ? [null]
    : await db()
        .select({ title: lessonRevisions.title, freePreview: lessonRevisions.isFreePreview })
        .from(lessons)
        .innerJoin(lessonRevisions, eq(lessonRevisions.id, lessons.publishedRevisionId))
        .where(eq(lessons.courseId, courseId))
        .orderBy(lessons.sort)
        .limit(1);
  const firstLesson = lesson ?? publishedLesson ?? null;
  return {
    id: course.id,
    slug: course.slug,
    status: course.status,
    title: revision.title,
    description: revision.description,
    priceMinor: revision.priceMinor,
    accessDays: revision.accessDays,
    lessonTitle: firstLesson?.title ?? null,
    freePreview: firstLesson?.freePreview ?? false,
  };
}

export type StatusResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_draft" | "not_approved" };

/** The teacher sends their own draft for review. */
export async function submitForReview(teacherId: string, courseId: string): Promise<StatusResult> {
  const [course] = await db()
    .select({ status: courses.status })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.teacherId, teacherId)))
    .limit(1);
  if (!course) return { ok: false, reason: "not_found" };
  // A teacher suspended (or not yet approved) after drafting cannot send work for review.
  if (!(await isApprovedTeacher(teacherId))) return { ok: false, reason: "not_approved" };
  const updated = await db()
    .update(courses)
    .set({ status: "in_review", updatedAt: clock.now() })
    .where(and(eq(courses.id, courseId), eq(courses.status, "draft")))
    .returning({ id: courses.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_draft" };
}

export type PendingCourse = {
  id: string;
  title: LocalizedText;
  teacherName: LocalizedText;
  submittedAt: Date;
};

/** Courses waiting for an admin to publish them, oldest first. */
export async function listPendingReview(): Promise<PendingCourse[]> {
  return db()
    .select({
      id: courses.id,
      title: courseRevisions.title,
      teacherName: teacherProfiles.publicName,
      submittedAt: courses.updatedAt,
    })
    .from(courses)
    .innerJoin(courseRevisions, eq(courseRevisions.id, courses.pendingRevisionId))
    .innerJoin(teacherProfiles, eq(teacherProfiles.userId, courses.teacherId))
    .where(and(eq(courses.status, "in_review"), eq(teacherProfiles.status, "approved")))
    .orderBy(courses.updatedAt);
}

export type PublishResult = { ok: true } | { ok: false; reason: "not_found" | "not_in_review" };

/**
 * Publishes an in-review course: its pending revisions (course, sections, lessons) become the
 * published ones, in one transaction with an audit row. Admin only (the router enforces it).
 */
export async function publishCourse(adminId: string, courseId: string): Promise<PublishResult> {
  return db().transaction(async (tx) => {
    const [course] = await tx.select().from(courses).where(eq(courses.id, courseId)).for("update");
    if (!course) return { ok: false, reason: "not_found" };
    if (course.status !== "in_review" || !course.pendingRevisionId) {
      return { ok: false, reason: "not_in_review" };
    }
    const now = clock.now();
    await tx
      .update(courses)
      .set({
        status: "published",
        publishedRevisionId: course.pendingRevisionId,
        pendingRevisionId: null,
        updatedAt: now,
      })
      .where(eq(courses.id, courseId));
    const courseSections = await tx
      .select({ id: sections.id, pending: sections.pendingRevisionId })
      .from(sections)
      .where(and(eq(sections.courseId, courseId), isNotNull(sections.pendingRevisionId)));
    for (const section of courseSections) {
      await tx
        .update(sections)
        .set({ publishedRevisionId: section.pending, pendingRevisionId: null })
        .where(eq(sections.id, section.id));
    }
    const courseLessons = await tx
      .select({ id: lessons.id, pending: lessons.pendingRevisionId })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), isNotNull(lessons.pendingRevisionId)));
    for (const lesson of courseLessons) {
      await tx
        .update(lessons)
        .set({ publishedRevisionId: lesson.pending, pendingRevisionId: null })
        .where(eq(lessons.id, lesson.id));
    }
    await writeAudit(tx, {
      actorId: adminId,
      action: "course.publish",
      subjectType: "course",
      subjectId: courseId,
      before: { status: course.status, publishedRevisionId: course.publishedRevisionId },
      after: {
        status: "published",
        revisionId: course.pendingRevisionId,
        teacherId: course.teacherId,
      },
    });
    return { ok: true };
  });
}
