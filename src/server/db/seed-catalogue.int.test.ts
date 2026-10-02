import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { getPublishedCourseBySlug, listPublishedCourses } from "@/server/catalog/repository";
import * as schema from "@/server/db/schema";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });

// Separate client: drizzle replaces the timestamp parsers of the client it wraps.
const repoClient = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const conn = drizzle(repoClient, { schema });

afterAll(async () => {
  await client.end();
  await repoClient.end();
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

const SAMPLE_SLUGS = [
  "math-grade-12-calculus",
  "physics-grade-11-mechanics",
  "chemistry-grade-10-foundations",
  "english-grade-9-writing",
];
const sectionTotal = 5;
const lessonTotal = 20;

async function rerunMigration() {
  const statements = readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) {
    await client.unsafe(statement);
  }
}

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
    await rerunMigration();
    expect(await fingerprint()).toEqual(before);
  });

  it.each(SAMPLE_SLUGS)("repository output for %s is stable", async (slug) => {
    expect(await getPublishedCourseBySlug(slug, conn)).toMatchSnapshot();
  });
});

describe("seed rerun after edits", () => {
  const COURSE = "00000000-0000-7000-8000-000000000301";
  const REVISION = "00000000-0000-7000-8000-000000000401";

  it("keeps edited titles and does not republish an unpublished sample course", async () => {
    const original = (await client`select title from course_revisions where id = ${REVISION}`)[0]
      ?.title;
    try {
      await client`update course_revisions set title = '{"ar":"x","en":"Edited title"}'::jsonb where id = ${REVISION}`;
      await client`update courses set status = 'hidden', published_revision_id = null where id = ${COURSE}`;
      await rerunMigration();
      const [rev] =
        await client`select title->>'en' as en from course_revisions where id = ${REVISION}`;
      expect(rev?.en).toBe("Edited title");
      const [course] = await client`select status from courses where id = ${COURSE}`;
      expect(course?.status).toBe("hidden");
      const slugs = (await listPublishedCourses(conn)).map((c) => c.slug);
      expect(slugs).not.toContain("math-grade-12-calculus");
    } finally {
      await client`update course_revisions set title = ${client.json(original)} where id = ${REVISION}`;
      await client`update courses set status = 'published', published_revision_id = ${REVISION} where id = ${COURSE}`;
    }
  });
});
