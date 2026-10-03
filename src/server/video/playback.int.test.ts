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
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  const conn = drizzle(client, { schema: dbSchema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => import("@/server/orders/test-fixtures").TestConn;
  closeTestDb: () => Promise<void>;
};
const conn = dbModule.db();
const { requestPlayback } = await import("./playback");
const { serveSample } = await import("./serve-sample");
const { createCourse, createDevice, createEntitlement, createUser, linkParent } = await import(
  "@/server/orders/test-fixtures"
);

/** Seeded by migration 0021: the bundled sample video. */
const SAMPLE_ASSET = "00000000-0000-7000-8000-000000000901";
const NOW = new Date("2030-05-01T09:00:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const DAY_MS = 86_400_000;
const KEY = Buffer.alloc(32, 5);
const deps = () => ({ limiter: new MemoryLimiter(), key: KEY });

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

/** A course whose paid and preview lessons both carry the sample video. */
async function courseWithVideo(options: Parameters<typeof createCourse>[1] = {}) {
  const course = await createCourse(conn, options);
  for (const lessonId of [course.lessonId, course.previewLessonId]) {
    const [lesson] = await conn
      .select({ revisionId: schema.lessons.publishedRevisionId })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId));
    if (!lesson?.revisionId) throw new Error("lesson has no published revision");
    await conn
      .update(schema.lessonRevisions)
      .set({ videoAssetId: SAMPLE_ASSET })
      .where(eq(schema.lessonRevisions.id, lesson.revisionId));
  }
  return course;
}

async function entitled(courseId: string, ends = DAY_MS) {
  const student = await createUser(conn);
  const deviceId = await createDevice(conn, student.id);
  await createEntitlement(conn, {
    studentId: student.id,
    courseId,
    startsAt: new Date(NOW.getTime() - DAY_MS),
    endsAt: new Date(NOW.getTime() + ends),
  });
  return { student, deviceId };
}

const as = (user: { id: string; role: UserRole }, deviceId: string | null = null) => ({
  id: user.id,
  role: user.role,
  deviceId,
});

function query(url: string) {
  const parsed = new URL(url, "https://alnamer.example");
  return {
    assetId: parsed.pathname.split("/").pop() ?? "",
    params: Object.fromEntries(parsed.searchParams),
  };
}

describe("requestPlayback leak rows", () => {
  it("issues a URL to the entitled student on an active device", async () => {
    const course = await courseWithVideo();
    const { student, deviceId } = await entitled(course.courseId);
    const result = await requestPlayback(as(student, deviceId), course.lessonId, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toMatch(/^\/api\/media\/sample\/00000000-0000-7000-8000-000000000901\?/);
    expect(result.expiresAt.getTime()).toBe(NOW.getTime() + 5 * 60 * 1000);
  });

  it("denies everyone else, with no URL", async () => {
    const course = await courseWithVideo();
    const other = await courseWithVideo();
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
    const otherTeacher = await createUser(conn, { role: "teacher" });
    const { student: onRevokedDevice } = await entitled(course.courseId);
    const deadDevice = await createDevice(conn, onRevokedDevice.id, { revoked: true });

    const rows: [string, ReturnType<typeof as>, string][] = [
      ["no entitlement", as(stranger, strangerDevice), "no_entitlement"],
      ["expired", as(expired, expiredDevice), "expired"],
      ["revoked", as(revoked, revokedDevice), "revoked"],
      ["parent of the entitled student", as(parent), "parent"],
      ["teacher of another course", as({ id: other.teacherId, role: "teacher" }), "no_entitlement"],
      ["a teacher with no course", as(otherTeacher), "no_entitlement"],
      ["revoked device", as(onRevokedDevice, deadDevice), "device_inactive"],
    ];
    for (const [name, user, reason] of rows) {
      expect(await requestPlayback(user, course.lessonId, deps()), name).toEqual({
        ok: false,
        reason,
      });
    }
  });

  it("allows the course teacher, an admin and a free preview", async () => {
    const course = await courseWithVideo();
    const admin = await createUser(conn, { role: "admin" });
    const stranger = await createUser(conn);
    const device = await createDevice(conn, stranger.id);
    for (const [user, lessonId] of [
      [as({ id: course.teacherId, role: "teacher" }), course.lessonId],
      [as(admin), course.lessonId],
      [as(stranger, device), course.previewLessonId],
    ] as const) {
      expect((await requestPlayback(user, lessonId, deps())).ok).toBe(true);
    }
  });

  it("answers no_video for a lesson without a video", async () => {
    const course = await createCourse(conn);
    const { student, deviceId } = await entitled(course.courseId);
    expect(await requestPlayback(as(student, deviceId), course.lessonId, deps())).toEqual({
      ok: false,
      reason: "no_video",
    });
  });
});

describe("serveSample", () => {
  async function issued() {
    const course = await courseWithVideo();
    const { student, deviceId } = await entitled(course.courseId);
    const result = await requestPlayback(as(student, deviceId), course.lessonId, deps());
    if (!result.ok) throw new Error("expected a playback URL");
    return { student, deviceId, ...query(result.url) };
  }

  it("serves the file to the same user on the same device, with byte ranges", async () => {
    const { student, deviceId, assetId, params } = await issued();
    const viewer = { userId: student.id, deviceId };
    const full = await serveSample({ assetId, params, range: null, viewer, nowS: NOW_S }, KEY);
    expect(full.status).toBe(200);
    expect(full.headers["Cache-Control"]).toBe("private, no-store");
    expect(Number(full.headers["Content-Length"])).toBeGreaterThan(1000);
    await full.body?.cancel();
    const part = await serveSample(
      { assetId, params, range: "bytes=0-99", viewer, nowS: NOW_S },
      KEY,
    );
    expect(part.status).toBe(206);
    expect(part.headers["Content-Length"]).toBe("100");
    expect(part.headers["Content-Range"]).toMatch(/^bytes 0-99\/\d+$/);
    await part.body?.cancel();
  });

  it("refuses another user, another device, no session, a tampered or expired URL", async () => {
    const { student, deviceId, assetId, params } = await issued();
    const other = await createUser(conn);
    const cases: [string, Parameters<typeof serveSample>[0]][] = [
      [
        "other user",
        { assetId, params, range: null, viewer: { userId: other.id, deviceId }, nowS: NOW_S },
      ],
      [
        "other device",
        {
          assetId,
          params,
          range: null,
          viewer: { userId: student.id, deviceId: "x" },
          nowS: NOW_S,
        },
      ],
      ["no session", { assetId, params, range: null, viewer: null, nowS: NOW_S }],
      [
        "tampered",
        {
          assetId,
          params: { ...params, e: String(NOW_S + 9999) },
          range: null,
          viewer: { userId: student.id, deviceId },
          nowS: NOW_S,
        },
      ],
      [
        "expired",
        {
          assetId,
          params,
          range: null,
          viewer: { userId: student.id, deviceId },
          nowS: NOW_S + 400,
        },
      ],
    ];
    for (const [name, input] of cases) {
      const response = await serveSample(input, KEY);
      expect(response.status, name).toBe(403);
      expect(response.body, name).toBeNull();
    }
  });
});
