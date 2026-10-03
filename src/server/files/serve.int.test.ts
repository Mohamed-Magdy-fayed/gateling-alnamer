import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import type { UserRole } from "@/server/db/schema";
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
const { serveLessonFile } = await import("./serve");
const { createCourse, createDevice, createEntitlement, createUser, linkParent } = await import(
  "@/server/orders/test-fixtures"
);

/** Seeded by migration 0022: the bundled sample PDF. */
const SAMPLE_PDF = "00000000-0000-7000-8000-000000000902";
const NOW = new Date("2030-05-01T09:00:00.000Z");
const DAY_MS = 86_400_000;

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

async function courseWithPdf() {
  const course = await createCourse(conn);
  const [lesson] = await conn
    .select({ revisionId: schema.lessons.publishedRevisionId })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, course.lessonId));
  if (!lesson?.revisionId) throw new Error("lesson has no published revision");
  await conn
    .update(schema.lessonRevisions)
    .set({ fileAssetId: SAMPLE_PDF })
    .where(eq(schema.lessonRevisions.id, lesson.revisionId));
  return course;
}

async function entitled(courseId: string) {
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

const as = (user: { id: string; role: UserRole }, deviceId: string | null = null) => ({
  id: user.id,
  role: user.role,
  deviceId,
});

describe("serveLessonFile", () => {
  it("serves the stamped PDF inline to the entitled student", async () => {
    const course = await courseWithPdf();
    const { student, deviceId } = await entitled(course.courseId);
    const response = await serveLessonFile(as(student, deviceId), course.lessonId, NOW);
    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/pdf");
    expect(response.headers["Cache-Control"]).toBe("private, no-store");
    expect(response.headers["Content-Disposition"]).toMatch(/^inline/);
    expect(Buffer.from(response.body?.slice(0, 4) ?? []).toString()).toBe("%PDF");
  });

  it("refuses anonymous (401) and every other viewer (403), with no body", async () => {
    const course = await courseWithPdf();
    const other = await courseWithPdf();
    const { student: owner } = await entitled(course.courseId);
    const stranger = await createUser(conn);
    const strangerDevice = await createDevice(conn, stranger.id);
    const expired = await createUser(conn);
    const expiredDevice = await createDevice(conn, expired.id);
    await createEntitlement(conn, {
      studentId: expired.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - 3 * DAY_MS),
      endsAt: new Date(NOW.getTime() - DAY_MS),
    });
    const revoked = await createUser(conn);
    const revokedDevice = await createDevice(conn, revoked.id);
    await createEntitlement(conn, {
      studentId: revoked.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - DAY_MS),
      endsAt: new Date(NOW.getTime() + DAY_MS),
      revokedAt: NOW,
    });
    const parent = await createUser(conn, { role: "parent" });
    await linkParent(conn, parent.id, owner.id);
    const { student: onDeadDevice } = await entitled(course.courseId);
    const deadDevice = await createDevice(conn, onDeadDevice.id, { revoked: true });

    expect((await serveLessonFile(null, course.lessonId, NOW)).status).toBe(401);
    const rows: [string, ReturnType<typeof as>][] = [
      ["no entitlement", as(stranger, strangerDevice)],
      ["expired", as(expired, expiredDevice)],
      ["revoked", as(revoked, revokedDevice)],
      ["parent of the entitled student", as(parent)],
      ["teacher of another course", as({ id: other.teacherId, role: "teacher" })],
      ["revoked device", as(onDeadDevice, deadDevice)],
    ];
    for (const [name, viewer] of rows) {
      const response = await serveLessonFile(viewer, course.lessonId, NOW);
      expect(response.status, name).toBe(403);
      expect(response.body, name).toBeNull();
    }
  });

  it("serves the course teacher and an admin (stamped with their own number)", async () => {
    const course = await courseWithPdf();
    const admin = await createUser(conn, { role: "admin" });
    for (const viewer of [as({ id: course.teacherId, role: "teacher" }), as(admin)]) {
      expect((await serveLessonFile(viewer, course.lessonId, NOW)).status).toBe(200);
    }
  });

  it("answers 404 for a lesson without a file", async () => {
    const course = await createCourse(conn);
    const { student, deviceId } = await entitled(course.courseId);
    expect((await serveLessonFile(as(student, deviceId), course.lessonId, NOW)).status).toBe(404);
  });
});
