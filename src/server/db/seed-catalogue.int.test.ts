import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { mockCourses } from "@/lib/mock-data";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });

afterAll(async () => {
  await client.end();
});

const MIGRATION = path.resolve(import.meta.dirname, "migrations/0008_sample_catalogue.sql");
const LOW = "00000000-0000-7000-8000-000000000001";
const HIGH = "00000000-0000-7000-8000-000000000999";

// Table -> column holding the (seed range) id used to scope checksums.
const SEED_TABLES: Array<[string, string]> = [
  ["users", "id"],
  ["teacher_profiles", "user_id"],
  ["categories", "id"],
  ["courses", "id"],
  ["course_revisions", "id"],
  ["course_categories", "course_id"],
  ["sections", "id"],
  ["section_revisions", "id"],
  ["lessons", "id"],
  ["lesson_revisions", "id"],
];

type Fingerprint = { count: number; checksum: string | null };

async function fingerprint(): Promise<Record<string, Fingerprint>> {
  const result: Record<string, Fingerprint> = {};
  for (const [table, key] of SEED_TABLES) {
    const rows = await client.unsafe(
      `select count(*)::int as count, md5(string_agg(t::text, '|' order by t::text)) as checksum
       from ${table} t where ${key} between '${LOW}' and '${HIGH}'`,
    );
    result[table] = {
      count: Number(rows[0]?.count ?? 0),
      checksum: (rows[0]?.checksum as string | null) ?? null,
    };
  }
  return result;
}

const lessonTotal = mockCourses.reduce(
  (sum, course) =>
    sum + course.sections.reduce((inner, section) => inner + section.lessons.length, 0),
  0,
);
const sectionTotal = mockCourses.reduce((sum, course) => sum + course.sections.length, 0);

describe("sample catalogue seed", () => {
  it("creates the expected number of rows", async () => {
    const counts = await fingerprint();
    expect(counts.users?.count).toBe(4);
    expect(counts.teacher_profiles?.count).toBe(4);
    expect(counts.courses?.count).toBe(4);
    expect(counts.course_revisions?.count).toBe(4);
    expect(counts.sections?.count).toBe(sectionTotal);
    expect(counts.section_revisions?.count).toBe(sectionTotal);
    expect(counts.lessons?.count).toBe(lessonTotal);
    expect(counts.lesson_revisions?.count).toBe(lessonTotal);
    expect(counts.categories?.count).toBe(12);
    expect(counts.course_categories?.count).toBe(12);
  });

  it("marks every seeded row as sample and sets published revisions", async () => {
    for (const [table, key] of SEED_TABLES) {
      const rows = await client.unsafe(
        `select count(*)::int as n from ${table} where ${key} between '${LOW}' and '${HIGH}' and not is_sample`,
      );
      expect(rows[0]?.n, table).toBe(0);
    }
    for (const table of ["courses", "sections", "lessons"]) {
      const rows = await client.unsafe(
        `select count(*)::int as n from ${table} where id between '${LOW}' and '${HIGH}' and published_revision_id is null`,
      );
      expect(rows[0]?.n, table).toBe(0);
    }
  });

  it("gives sample teachers no credentials", async () => {
    const rows = await client`
      select count(*)::int as n from credentials where user_id between ${LOW} and ${HIGH}`;
    expect(rows[0]?.n).toBe(0);
    const users = await client`
      select email, role from users where id between ${LOW} and ${HIGH} order by email`;
    expect(users.map((user) => user.email)).toEqual(
      [1, 2, 3, 4].map((n) => `sample-teacher-${n}@example.invalid`),
    );
    expect(users.every((user) => user.role === "teacher")).toBe(true);
  });

  it("changes nothing when the migration SQL runs a second time", async () => {
    const before = await fingerprint();
    const statements = readFileSync(MIGRATION, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      await client.unsafe(statement);
    }
    expect(await fingerprint()).toEqual(before);
  });

  it("matches mock-data for every course", async () => {
    for (const mock of mockCourses) {
      const courseRows = await client`
        select c.id, c.slug, c.status, c.teacher_id, r.title, r.description, r.price_minor,
               r.access_kind, r.access_end_at, r.access_days, r.estimated_hours
        from courses c join course_revisions r on r.id = c.published_revision_id
        where c.slug = ${mock.slug}`;
      expect(courseRows, mock.slug).toHaveLength(1);
      const course = courseRows[0];
      if (!course) throw new Error(`missing ${mock.slug}`);
      expect(course.status).toBe("published");
      expect(course.title).toEqual(mock.title);
      expect(course.description).toEqual(mock.description);
      expect(Number(course.price_minor)).toBe(mock.priceMinor);
      expect(course.estimated_hours).toBe(mock.hours);
      if (mock.access.kind === "until") {
        expect(course.access_kind).toBe("fixed_end");
        expect((course.access_end_at as Date).getTime()).toBe(
          new Date(`${mock.access.date}T23:59:59+04:00`).getTime(),
        );
        expect(course.access_days).toBeNull();
      } else {
        expect(course.access_kind).toBe("duration_days");
        expect(course.access_days).toBe(mock.access.days);
        expect(course.access_end_at).toBeNull();
      }

      const teacher = await client`
        select u.name, p.public_name, p.bio, p.status
        from users u join teacher_profiles p on p.user_id = u.id where u.id = ${course.teacher_id as string}`;
      expect(teacher[0]?.public_name).toEqual(mock.teacher);
      expect(teacher[0]?.bio).toEqual(mock.teacherBio);
      expect(teacher[0]?.name).toBe(mock.teacher.ar);
      expect(teacher[0]?.status).toBe("approved");

      const categories = await client`
        select k.type, k.name_ar, k.name_en from course_categories cc
        join categories k on k.id = cc.category_id where cc.course_id = ${course.id as string}`;
      const byType = Object.fromEntries(categories.map((row) => [row.type as string, row]));
      expect([byType.curriculum?.name_ar, byType.curriculum?.name_en]).toEqual([
        mock.curriculum.ar,
        mock.curriculum.en,
      ]);
      expect([byType.grade?.name_ar, byType.grade?.name_en]).toEqual([
        mock.grade.ar,
        mock.grade.en,
      ]);
      expect([byType.subject?.name_ar, byType.subject?.name_en]).toEqual([
        mock.subject.ar,
        mock.subject.en,
      ]);

      const sections = await client`
        select s.id, s.sort, sr.title from sections s
        join section_revisions sr on sr.id = s.published_revision_id
        where s.course_id = ${course.id as string} order by s.sort`;
      expect(sections.map((row) => row.title)).toEqual(
        mock.sections.map((section) => section.title),
      );
      for (const [index, section] of sections.entries()) {
        const lessons = await client`
          select l.kind, l.sort, lr.title, lr.duration_minutes, lr.is_free_preview from lessons l
          join lesson_revisions lr on lr.id = l.published_revision_id
          where l.section_id = ${section.id as string} order by l.sort`;
        const expected = mock.sections[index]?.lessons ?? [];
        expect(
          lessons.map((row) => ({
            title: row.title,
            kind: row.kind,
            minutes: row.duration_minutes,
            free: row.is_free_preview,
          })),
        ).toEqual(
          expected.map((lesson) => ({
            title: lesson.title,
            kind: lesson.kind,
            minutes: lesson.minutes,
            free: lesson.free,
          })),
        );
      }
    }
  });
});
