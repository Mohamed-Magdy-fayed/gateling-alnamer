import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";

// Shared by the orders, access and router integration tests. Never imported by app code.
export type TestConn = PostgresJsDatabase<typeof schema>;
type Role = (typeof schema.userRole.enumValues)[number];

export type TestUser = {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  status: "active";
};

export async function createUser(
  conn: TestConn,
  options: { role?: Role; verified?: boolean; email?: boolean } = {},
): Promise<TestUser> {
  const role = options.role ?? "student";
  const withEmail = options.email ?? true;
  const [row] = await conn
    .insert(schema.users)
    .values({
      name: `${role} user`,
      email: withEmail ? `${role}-${randomUUID()}@example.test` : null,
      username: withEmail ? null : `u${randomUUID().slice(0, 8)}`,
      role,
      emailVerifiedAt: withEmail && (options.verified ?? true) ? new Date() : null,
      dateOfBirth: role === "parent" ? "1985-01-01" : "2015-01-01",
    })
    .returning({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      status: schema.users.status,
    });
  if (!row) throw new Error("user insert returned no row");
  return row as TestUser;
}

export async function linkParent(conn: TestConn, parentId: string, studentId: string) {
  await conn.insert(schema.parentLinks).values({ parentId, studentId, source: "invite" });
}

export async function createDevice(
  conn: TestConn,
  userId: string,
  options: { revoked?: boolean } = {},
): Promise<string> {
  const [row] = await conn
    .insert(schema.devices)
    .values({
      userId,
      deviceKey: randomUUID(),
      revokedAt: options.revoked ? new Date() : null,
      revokedReason: options.revoked ? "self" : null,
    })
    .returning({ id: schema.devices.id });
  if (!row) throw new Error("device insert returned no row");
  return row.id;
}

export type TestCourse = {
  courseId: string;
  revisionId: string;
  teacherId: string;
  /** A paid lesson. */
  lessonId: string;
  /** A free-preview lesson. */
  previewLessonId: string;
};

export type CourseOptions = {
  priceMinor?: number;
  access?: { kind: "fixed_end"; endAt: Date } | { kind: "duration_days"; days: number };
  isSample?: boolean;
  status?: (typeof schema.courseStatus.enumValues)[number];
  teacherId?: string;
};

export async function createCourse(
  conn: TestConn,
  options: CourseOptions = {},
): Promise<TestCourse> {
  const teacherId =
    options.teacherId ??
    (await (async () => {
      const teacher = await createUser(conn, { role: "teacher" });
      await conn.insert(schema.teacherProfiles).values({
        userId: teacher.id,
        publicName: { en: "Teacher" },
        bio: { en: "Bio" },
        status: "approved",
      });
      return teacher.id;
    })());
  const status = options.status ?? "published";
  const published = status === "published";
  const access = options.access ?? { kind: "duration_days", days: 30 };
  const courseId = randomUUID();
  const revisionId = randomUUID();
  const sectionId = randomUUID();
  const sectionRevisionId = randomUUID();
  const lessonId = randomUUID();
  const previewLessonId = randomUUID();
  const isSample = options.isSample ?? false;

  await conn.insert(schema.courses).values({
    id: courseId,
    slug: `c-${courseId}`,
    teacherId,
    status,
    isSample,
  });
  await conn.insert(schema.courseRevisions).values({
    id: revisionId,
    courseId,
    title: { en: "Course" },
    description: { en: "Description" },
    priceMinor: options.priceMinor ?? 5000,
    accessKind: access.kind,
    accessEndAt: access.kind === "fixed_end" ? access.endAt : null,
    accessDays: access.kind === "duration_days" ? access.days : null,
    isSample,
  });
  await conn
    .update(schema.courses)
    .set({ publishedRevisionId: published ? revisionId : null })
    .where(eq(schema.courses.id, courseId));
  await conn.insert(schema.sections).values({ id: sectionId, courseId, sort: 1, isSample });
  await conn
    .insert(schema.sectionRevisions)
    .values({ id: sectionRevisionId, sectionId, title: { en: "Section" }, isSample });
  await conn
    .update(schema.sections)
    .set({ publishedRevisionId: sectionRevisionId })
    .where(eq(schema.sections.id, sectionId));
  for (const [id, sort, free] of [
    [lessonId, 1, false],
    [previewLessonId, 2, true],
  ] as const) {
    const lessonRevisionId = randomUUID();
    await conn
      .insert(schema.lessons)
      .values({ id, courseId, sectionId, kind: "video", sort, isSample });
    await conn.insert(schema.lessonRevisions).values({
      id: lessonRevisionId,
      lessonId: id,
      title: { en: "Lesson" },
      isFreePreview: free,
      isSample,
    });
    await conn
      .update(schema.lessons)
      .set({ publishedRevisionId: published ? lessonRevisionId : null })
      .where(eq(schema.lessons.id, id));
  }
  return { courseId, revisionId, teacherId, lessonId, previewLessonId };
}

export async function createEntitlement(
  conn: TestConn,
  input: {
    studentId: string;
    courseId: string;
    startsAt: Date;
    endsAt: Date;
    revokedAt?: Date | null;
  },
): Promise<string> {
  const id = randomUUID();
  await conn.insert(schema.entitlements).values({
    id,
    studentId: input.studentId,
    courseId: input.courseId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    source: "admin_grant",
    revokedAt: input.revokedAt ?? null,
  });
  return id;
}
