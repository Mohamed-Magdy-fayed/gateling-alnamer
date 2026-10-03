import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import type { UserRole } from "@/server/db/schema";

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
const { getLessonAccess } = await import("./lesson-access");
const { createCourse, createDevice, createEntitlement, createUser, linkParent } = await import(
  "@/server/orders/test-fixtures"
);

const NOW = new Date("2030-05-01T09:00:00.000Z");
const DAY_MS = 86_400_000;

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

async function entitledStudent(courseId: string) {
  const student = await createUser(conn);
  const deviceId = await createDevice(conn, student.id);
  await createEntitlement(conn, {
    studentId: student.id,
    courseId,
    startsAt: new Date(NOW.getTime() - DAY_MS),
    endsAt: new Date(NOW.getTime() + DAY_MS),
  });
  return { student, deviceId };
}

const asUser = (user: { id: string; role: UserRole }, deviceId: string | null = null) => ({
  id: user.id,
  role: user.role,
  deviceId,
});

describe("getLessonAccess denial table", () => {
  it("anonymous is denied a paid lesson", async () => {
    const course = await createCourse(conn);
    expect(await getLessonAccess(null, course.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "anonymous",
    });
  });

  it("a student without an entitlement is denied", async () => {
    const course = await createCourse(conn);
    const student = await createUser(conn);
    const deviceId = await createDevice(conn, student.id);
    expect(await getLessonAccess(asUser(student, deviceId), course.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "no_entitlement",
    });
  });

  it("an expired entitlement is denied", async () => {
    const course = await createCourse(conn);
    const student = await createUser(conn);
    const deviceId = await createDevice(conn, student.id);
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - 10 * DAY_MS),
      endsAt: new Date(NOW.getTime() - DAY_MS),
    });
    expect(await getLessonAccess(asUser(student, deviceId), course.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "expired",
    });
  });

  it("the entitlement end is exclusive and the start is inclusive", async () => {
    const course = await createCourse(conn);
    const student = await createUser(conn);
    const deviceId = await createDevice(conn, student.id);
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + DAY_MS),
    });
    expect((await getLessonAccess(asUser(student, deviceId), course.lessonId, NOW)).allowed).toBe(
      true,
    );
    expect(
      await getLessonAccess(
        asUser(student, deviceId),
        course.lessonId,
        new Date(NOW.getTime() + DAY_MS),
      ),
    ).toEqual({ allowed: false, reason: "expired" });
  });

  it("a revoked entitlement is denied", async () => {
    const course = await createCourse(conn);
    const student = await createUser(conn);
    const deviceId = await createDevice(conn, student.id);
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - DAY_MS),
      endsAt: new Date(NOW.getTime() + DAY_MS),
      revokedAt: new Date(NOW.getTime() - 1000),
    });
    expect(await getLessonAccess(asUser(student, deviceId), course.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "revoked",
    });
  });

  it("a parent of the entitled student is denied", async () => {
    const course = await createCourse(conn);
    const { student } = await entitledStudent(course.courseId);
    const parent = await createUser(conn, { role: "parent" });
    await linkParent(conn, parent.id, student.id);
    expect(await getLessonAccess(asUser(parent), course.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "parent",
    });
  });

  it("a teacher of another course is denied", async () => {
    const course = await createCourse(conn);
    const other = await createCourse(conn);
    expect(
      await getLessonAccess(asUser({ id: other.teacherId, role: "teacher" }), course.lessonId, NOW),
    ).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("a student on a revoked device, or without a device, is denied", async () => {
    const course = await createCourse(conn);
    const { student } = await entitledStudent(course.courseId);
    const revoked = await createDevice(conn, student.id, { revoked: true });
    expect(await getLessonAccess(asUser(student, revoked), course.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "device_inactive",
    });
    expect(await getLessonAccess(asUser(student, null), course.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "device_inactive",
    });
  });

  it("unknown and unpublished lessons", async () => {
    const draft = await createCourse(conn, { status: "draft" });
    const student = await createUser(conn);
    const deviceId = await createDevice(conn, student.id);
    expect(await getLessonAccess(asUser(student, deviceId), randomUUID(), NOW)).toEqual({
      allowed: false,
      reason: "not_found",
    });
    expect(await getLessonAccess(asUser(student, deviceId), draft.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "not_published",
    });
    expect(await getLessonAccess(null, draft.previewLessonId, NOW)).toEqual({
      allowed: false,
      reason: "not_published",
    });
  });
});

describe("getLessonAccess grants", () => {
  it("the entitled student on an active device", async () => {
    const course = await createCourse(conn);
    const { student, deviceId } = await entitledStudent(course.courseId);
    const result = await getLessonAccess(asUser(student, deviceId), course.lessonId, NOW);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.grant).toMatchObject({
        lessonId: course.lessonId,
        userId: student.id,
        mode: "entitled",
      });
    }
  });

  it("an entitlement for another course does not open this lesson", async () => {
    const course = await createCourse(conn);
    const other = await createCourse(conn);
    const { student, deviceId } = await entitledStudent(other.courseId);
    expect(await getLessonAccess(asUser(student, deviceId), course.lessonId, NOW)).toEqual({
      allowed: false,
      reason: "no_entitlement",
    });
  });

  it("a published free preview opens for anonymous visitors and students", async () => {
    const course = await createCourse(conn);
    const anonymous = await getLessonAccess(null, course.previewLessonId, NOW);
    expect(anonymous.allowed && anonymous.grant.mode).toBe("preview");
    const student = await createUser(conn);
    const viaStudent = await getLessonAccess(asUser(student, null), course.previewLessonId, NOW);
    expect(viaStudent.allowed).toBe(true);
  });

  it("the course teacher, an admin and a reviewer may preview", async () => {
    const course = await createCourse(conn);
    const admin = await createUser(conn, { role: "admin" });
    const reviewer = await createUser(conn, { role: "reviewer" });
    for (const user of [{ id: course.teacherId, role: "teacher" as const }, admin, reviewer]) {
      const result = await getLessonAccess(asUser(user), course.lessonId, NOW);
      expect(result.allowed && result.grant.mode).toBe("staff_preview");
    }
  });
});
