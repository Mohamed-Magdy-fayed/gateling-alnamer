import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
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
const { activeAccessEnds, listChildrenCourses, listStudentCourses } = await import("./my-courses");
const { getBuyState } = await import("./buy-state");
const { createCourse, createEntitlement, createUser, linkParent } = await import("./test-fixtures");

const NOW = new Date("2030-05-01T09:00:00.000Z");
const DAY_MS = 86_400_000;
const days = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

afterAll(async () => {
  await dbModule.closeTestDb();
});

describe("listStudentCourses", () => {
  it("lists live courses first (soonest end first), then ended and revoked ones", async () => {
    const student = await createUser(conn);
    const soon = await createCourse(conn);
    const later = await createCourse(conn);
    const ended = await createCourse(conn);
    const revoked = await createCourse(conn);
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: later.courseId,
      startsAt: days(-1),
      endsAt: days(20),
    });
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: soon.courseId,
      startsAt: days(-1),
      endsAt: days(5),
    });
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: ended.courseId,
      startsAt: days(-40),
      endsAt: days(-10),
    });
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: revoked.courseId,
      startsAt: days(-1),
      endsAt: days(30),
      revokedAt: days(-1),
    });

    const list = await listStudentCourses(student.id, NOW, conn);
    expect(list.map((row) => [row.courseId, row.active])).toEqual([
      [soon.courseId, true],
      [later.courseId, true],
      [ended.courseId, false],
      [revoked.courseId, false],
    ]);
    expect(list[0]?.firstLessonId).toBe(soon.lessonId);
  });

  it("keeps one row per course, with the latest live end", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: days(-30),
      endsAt: days(-1),
    });
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: days(-1),
      endsAt: days(9),
    });
    const list = await listStudentCourses(student.id, NOW, conn);
    expect(list).toHaveLength(1);
    expect(list[0]?.active).toBe(true);
    expect(list[0]?.endsAt.toISOString()).toBe(days(9).toISOString());
  });

  it("never lists another student's courses", async () => {
    const owner = await createUser(conn);
    const other = await createUser(conn);
    const course = await createCourse(conn);
    await createEntitlement(conn, {
      studentId: owner.id,
      courseId: course.courseId,
      startsAt: days(-1),
      endsAt: days(9),
    });
    expect(await listStudentCourses(other.id, NOW, conn)).toEqual([]);
  });
});

describe("activeAccessEnds and listChildrenCourses", () => {
  it("returns live access only, per child", async () => {
    const childA = await createUser(conn);
    const childB = await createUser(conn);
    const course = await createCourse(conn);
    await createEntitlement(conn, {
      studentId: childA.id,
      courseId: course.courseId,
      startsAt: days(-1),
      endsAt: days(9),
    });
    await createEntitlement(conn, {
      studentId: childB.id,
      courseId: course.courseId,
      startsAt: days(-20),
      endsAt: days(-2),
    });

    const ends = await activeAccessEnds([childA.id, childB.id], course.courseId, NOW, conn);
    expect([...ends.keys()]).toEqual([childA.id]);

    const byChild = await listChildrenCourses([childA.id, childB.id], NOW, conn);
    expect(byChild.get(childA.id)?.map((row) => row.courseId)).toEqual([course.courseId]);
    expect(byChild.has(childB.id)).toBe(false);
  });
});

describe("getBuyState", () => {
  it("mirrors the checkout rules for each kind of viewer", async () => {
    const course = await createCourse(conn);
    expect(await getBuyState(null, course.courseId, NOW)).toEqual({ kind: "anonymous" });

    const teacher = await createUser(conn, { role: "teacher" });
    expect((await getBuyState(teacher, course.courseId, NOW)).kind).toBe("not_buyer");

    const student = await createUser(conn);
    expect((await getBuyState(student, course.courseId, NOW)).kind).toBe("student_can_buy");
    const unverified = await createUser(conn, { verified: false });
    expect((await getBuyState(unverified, course.courseId, NOW)).kind).toBe("student_verify_email");
    const noEmail = await createUser(conn, { email: false });
    expect((await getBuyState(noEmail, course.courseId, NOW)).kind).toBe("student_ask_parent");

    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: days(-1),
      endsAt: days(9),
    });
    expect(await getBuyState(student, course.courseId, NOW)).toEqual({
      kind: "student_has_access",
      endsAt: days(9),
    });
  });

  it("lists only the parent's own linked children, with their access", async () => {
    const course = await createCourse(conn);
    const parent = await createUser(conn, { role: "parent" });
    expect((await getBuyState(parent, course.courseId, NOW)).kind).toBe("parent_no_children");

    const child = await createUser(conn);
    const stranger = await createUser(conn);
    await linkParent(conn, parent.id, child.id);
    await createEntitlement(conn, {
      studentId: stranger.id,
      courseId: course.courseId,
      startsAt: days(-1),
      endsAt: days(9),
    });
    const state = await getBuyState(parent, course.courseId, NOW);
    expect(state).toEqual({
      kind: "parent",
      children: [{ id: child.id, name: child.name, accessEndsAt: null }],
    });

    const unverified = await createUser(conn, { role: "parent", verified: false });
    expect((await getBuyState(unverified, course.courseId, NOW)).kind).toBe("parent_verify_email");
  });
});
