import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const conn = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

const id = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = { ar: "عنوان", en: "Title" };

async function teacher(n: number): Promise<string> {
  const userId = id(900000 + n);
  await conn.insert(schema.users).values({
    id: userId,
    name: `T${n}`,
    email: `t${n}@example.invalid`,
    role: "teacher",
    isSample: true,
  });
  return userId;
}

describe("content schema", () => {
  it("rejects mixed or incomplete access fields", async () => {
    const teacherId = await teacher(1);
    const courseId = id(900101);
    await conn.insert(schema.courses).values({ id: courseId, slug: "mixed-a", teacherId });
    const base = { courseId, title: text, description: text, priceMinor: 100 };
    await expect(
      conn.insert(schema.courseRevisions).values({
        ...base,
        id: id(900201),
        accessKind: "fixed_end",
        accessEndAt: new Date(),
        accessDays: 30,
      }),
    ).rejects.toThrow();
    await expect(
      conn.insert(schema.courseRevisions).values({
        ...base,
        id: id(900202),
        accessKind: "duration_days",
        accessDays: 30,
        accessEndAt: new Date(),
      }),
    ).rejects.toThrow();
    await expect(
      conn.insert(schema.courseRevisions).values({
        ...base,
        id: id(900203),
        accessKind: "fixed_end",
      }),
    ).rejects.toThrow();
    await expect(
      conn.insert(schema.courseRevisions).values({
        ...base,
        id: id(900204),
        accessKind: "duration_days",
        accessDays: 0,
      }),
    ).rejects.toThrow();
  });

  it("rejects a negative price", async () => {
    const teacherId = await teacher(2);
    const courseId = id(900102);
    await conn.insert(schema.courses).values({ id: courseId, slug: "neg-price", teacherId });
    await expect(
      conn.insert(schema.courseRevisions).values({
        id: id(900205),
        courseId,
        title: text,
        description: text,
        priceMinor: -1,
        accessKind: "duration_days",
        accessDays: 30,
      }),
    ).rejects.toThrow();
  });

  it("restricts deleting a user that has a teacher profile", async () => {
    const userId = await teacher(3);
    await conn.insert(schema.teacherProfiles).values({
      userId,
      publicName: text,
      bio: text,
      isSample: true,
    });
    await expect(conn.delete(schema.users).where(eq(schema.users.id, userId))).rejects.toThrow();
  });

  it("rejects a non-object localized text", async () => {
    const userId = await teacher(4);
    await expect(
      client`insert into teacher_profiles (user_id, public_name, bio) values (${userId}, '"plain"'::jsonb, '{"en":"x"}'::jsonb)`,
    ).rejects.toThrow();
    await expect(
      client`insert into teacher_profiles (user_id, public_name, bio) values (${userId}, '{"en":"x"}'::jsonb, '[]'::jsonb)`,
    ).rejects.toThrow();
  });

  it("inserts a course with revision, section, lesson and their revisions", async () => {
    const teacherId = await teacher(5);
    const courseId = id(900103);
    const courseRev = id(900206);
    const sectionId = id(900301);
    const sectionRev = id(900401);
    const lessonId = id(900501);
    const lessonRev = id(900601);

    await conn.insert(schema.courses).values({ id: courseId, slug: "valid-course", teacherId });
    await conn.insert(schema.courseRevisions).values({
      id: courseRev,
      courseId,
      title: text,
      description: text,
      priceMinor: 25000,
      accessKind: "fixed_end",
      accessEndAt: new Date("2027-06-30T23:59:59+04:00"),
    });
    await conn
      .update(schema.courses)
      .set({ publishedRevisionId: courseRev, status: "published" })
      .where(eq(schema.courses.id, courseId));

    await conn.insert(schema.sections).values({ id: sectionId, courseId, sort: 1 });
    await conn.insert(schema.sectionRevisions).values({ id: sectionRev, sectionId, title: text });
    await conn
      .update(schema.sections)
      .set({ publishedRevisionId: sectionRev })
      .where(eq(schema.sections.id, sectionId));

    await conn
      .insert(schema.lessons)
      .values({ id: lessonId, courseId, sectionId, kind: "video", sort: 1 });
    await conn.insert(schema.lessonRevisions).values({
      id: lessonRev,
      lessonId,
      title: text,
      isFreePreview: true,
      durationMinutes: 12,
    });
    await conn
      .update(schema.lessons)
      .set({ publishedRevisionId: lessonRev })
      .where(eq(schema.lessons.id, lessonId));

    const [row] = await conn.select().from(schema.courses).where(eq(schema.courses.id, courseId));
    expect(row?.publishedRevisionId).toBe(courseRev);
    expect(row?.status).toBe("published");
    expect(row?.isSample).toBe(false);
  });
});
