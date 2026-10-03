import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import type { UserRole } from "@/server/db/schema";
import * as schema from "@/server/db/schema";
import { MemoryLimiter } from "../../../test/fake-limiter";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example", APP_MODE: "demo" }),
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const dbSchema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 6, onnotice: () => {} });
  const conn = drizzle(client, { schema: dbSchema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => import("@/server/orders/test-fixtures").TestConn;
  closeTestDb: () => Promise<void>;
};
const conn = dbModule.db();
const { quizStateFor, startQuizFor, submitQuizFor } = await import("./service");
const { createCourse, createDevice, createEntitlement, createUser, linkParent } = await import(
  "@/server/orders/test-fixtures"
);

const NOW = new Date("2030-05-01T09:00:00.000Z");
const DAY_MS = 86_400_000;
const deps = () => ({ limiter: new MemoryLimiter(), key: Buffer.alloc(32, 3) });

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

/** A course whose paid lesson carries a 2-question quiz (q1 correct "b", q2 correct "true"). */
async function courseWithQuiz(options: { maxAttempts?: number; timeLimitS?: number } = {}) {
  const course = await createCourse(conn);
  const bankId = randomUUID();
  const q1 = randomUUID();
  const q2 = randomUUID();
  const quizId = randomUUID();
  await conn
    .insert(schema.questionBanks)
    .values({ id: bankId, teacherId: course.teacherId, title: { en: "Bank" } });
  await conn.insert(schema.questions).values([
    {
      id: q1,
      bankId,
      kind: "mcq",
      body: { en: "Q1" },
      options: [
        { id: "a", text: { en: "A" } },
        { id: "b", text: { en: "B" } },
      ],
      correct: "b",
    },
    {
      id: q2,
      bankId,
      kind: "true_false",
      body: { en: "Q2" },
      options: [
        { id: "true", text: { en: "True" } },
        { id: "false", text: { en: "False" } },
      ],
      correct: "true",
    },
  ]);
  await conn.insert(schema.quizzes).values({
    id: quizId,
    courseId: course.courseId,
    title: { en: "Quiz" },
    maxAttempts: options.maxAttempts ?? 3,
    timeLimitS: options.timeLimitS ?? 600,
  });
  await conn.insert(schema.quizQuestions).values([
    { quizId, questionId: q1, sort: 1 },
    { quizId, questionId: q2, sort: 2 },
  ]);
  const [lesson] = await conn
    .select({ revisionId: schema.lessons.publishedRevisionId })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, course.lessonId));
  if (!lesson?.revisionId) throw new Error("no revision");
  await conn
    .update(schema.lessonRevisions)
    .set({ quizId })
    .where(eq(schema.lessonRevisions.id, lesson.revisionId));
  return { ...course, quizId, q1, q2 };
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
  return { id: student.id, role: "student" as UserRole, deviceId };
}

describe("quiz start and submit", () => {
  it("starts an attempt without the answer key, grades the submit, keeps the best score", async () => {
    const course = await courseWithQuiz();
    const student = await entitled(course.courseId);
    const first = await startQuizFor(student, course.lessonId, deps());
    if (!first.ok) throw new Error(`start failed: ${first.reason}`);
    expect(JSON.stringify(first)).not.toMatch(/"correct"|explanation/);
    expect(first.deadlineAt?.getTime()).toBe(NOW.getTime() + 600_000);

    // A second start resumes the open attempt instead of making another.
    const again = await startQuizFor(student, course.lessonId, deps());
    expect(again.ok && again.attemptId).toBe(first.attemptId);

    const graded = await submitQuizFor(
      student,
      course.lessonId,
      first.attemptId,
      { [course.q1]: "b", [course.q2]: "false" },
      deps(),
    );
    expect(graded).toMatchObject({ ok: true, scorePct: 50, bestScore: 50, attemptsLeft: 2 });

    const second = await startQuizFor(student, course.lessonId, deps());
    if (!second.ok) throw new Error("second start failed");
    const better = await submitQuizFor(
      student,
      course.lessonId,
      second.attemptId,
      { [course.q1]: "b", [course.q2]: "true" },
      deps(),
    );
    expect(better).toMatchObject({ ok: true, scorePct: 100, bestScore: 100, passed: true });

    const state = await quizStateFor(student, course.lessonId);
    expect(state.ok && state.state.bestScore).toBe(100);
    expect(JSON.stringify(state)).not.toMatch(/"correct"/);
  });

  it("refuses a start once the attempts are used up", async () => {
    const course = await courseWithQuiz({ maxAttempts: 1 });
    const student = await entitled(course.courseId);
    const first = await startQuizFor(student, course.lessonId, deps());
    if (!first.ok) throw new Error("start failed");
    await submitQuizFor(student, course.lessonId, first.attemptId, {}, deps());
    expect(await startQuizFor(student, course.lessonId, deps())).toEqual({
      ok: false,
      reason: "no_attempts_left",
    });
  });

  it("refuses a double submit and another student's attempt", async () => {
    const course = await courseWithQuiz();
    const owner = await entitled(course.courseId);
    const other = await entitled(course.courseId);
    const attempt = await startQuizFor(owner, course.lessonId, deps());
    if (!attempt.ok) throw new Error("start failed");
    expect(await submitQuizFor(other, course.lessonId, attempt.attemptId, {}, deps())).toEqual({
      ok: false,
      reason: "not_found",
    });
    await submitQuizFor(owner, course.lessonId, attempt.attemptId, {}, deps());
    expect(await submitQuizFor(owner, course.lessonId, attempt.attemptId, {}, deps())).toEqual({
      ok: false,
      reason: "already_submitted",
    });
  });

  it("grades a late submit as-is and marks it late", async () => {
    const course = await courseWithQuiz({ timeLimitS: 60 });
    const student = await entitled(course.courseId);
    const attempt = await startQuizFor(student, course.lessonId, deps());
    if (!attempt.ok) throw new Error("start failed");
    setClockForTests(new Date(NOW.getTime() + 60_000 + 11_000));
    const graded = await submitQuizFor(
      student,
      course.lessonId,
      attempt.attemptId,
      { [course.q1]: "b" },
      deps(),
    );
    expect(graded).toMatchObject({ ok: true, scorePct: 50, late: true });
  });

  it("denies the leak rows at start", async () => {
    const course = await courseWithQuiz();
    const other = await courseWithQuiz();
    const owner = await entitled(course.courseId);
    const stranger = await createUser(conn);
    const strangerDevice = await createDevice(conn, stranger.id);
    const parent = await createUser(conn, { role: "parent" });
    await linkParent(conn, parent.id, owner.id);
    const expired = await createUser(conn);
    const expiredDevice = await createDevice(conn, expired.id);
    await createEntitlement(conn, {
      studentId: expired.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - 3 * DAY_MS),
      endsAt: new Date(NOW.getTime() - DAY_MS),
    });
    const onDead = await entitled(course.courseId);
    const deadDevice = await createDevice(conn, onDead.id, { revoked: true });
    const rows: [string, { id: string; role: UserRole; deviceId: string | null }, string][] = [
      [
        "no entitlement",
        { id: stranger.id, role: "student", deviceId: strangerDevice },
        "no_entitlement",
      ],
      ["expired", { id: expired.id, role: "student", deviceId: expiredDevice }, "expired"],
      ["parent", { id: parent.id, role: "parent", deviceId: null }, "parent"],
      [
        "teacher of another course",
        { id: other.teacherId, role: "teacher", deviceId: null },
        "no_entitlement",
      ],
      ["revoked device", { ...onDead, deviceId: deadDevice }, "device_inactive"],
    ];
    for (const [name, user, reason] of rows) {
      expect(await startQuizFor(user, course.lessonId, deps()), name).toEqual({
        ok: false,
        reason,
      });
    }
  });

  it("lets the course teacher see the quiz but not take attempts", async () => {
    const course = await courseWithQuiz();
    const teacher = { id: course.teacherId, role: "teacher" as UserRole, deviceId: null };
    const state = await quizStateFor(teacher, course.lessonId);
    expect(state.ok && state.state.canAttempt).toBe(false);
    expect(await startQuizFor(teacher, course.lessonId, deps())).toEqual({
      ok: false,
      reason: "preview_only",
    });
  });
});
