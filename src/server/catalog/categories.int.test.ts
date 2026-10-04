import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

/** Right-to-left override, written as an escape so no invisible control sits in the source. */
const RLO = String.fromCharCode(0x202e);

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
const { createUser } = await import("@/server/orders/test-fixtures");
const {
  createCategory,
  deleteCategory,
  listCategoriesForAdmin,
  listCategoryTree,
  moveCategory,
  updateCategory,
} = await import("./categories");

afterAll(async () => {
  await dbModule.closeTestDb();
});

const sampleId = (n: number) => `00000000-0000-7000-8000-000000000${n}`;
const MATHEMATICS = sampleId(209);
const UAE_MOE = sampleId(201);

const admin = await createUser(conn, { role: "admin" });
const unique = () => crypto.randomUUID().slice(0, 8);

async function auditFor(action: string, subjectId: string) {
  return conn
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.subjectId, subjectId)));
}

async function newCurriculum() {
  const word = unique();
  const result = await createCategory({
    actorId: admin.id,
    type: "curriculum",
    parentId: null,
    nameAr: `منهج ${word}`,
    nameEn: `Curriculum ${word}`,
    slug: "",
  });
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

async function newGrade(parentId: string, label: string) {
  const result = await createCategory({
    actorId: admin.id,
    type: "grade",
    parentId,
    nameAr: `الصف ${label}`,
    nameEn: `Grade ${label}`,
    slug: "",
  });
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

describe("sample taxonomy", () => {
  it("has four curricula with their own grades, in order", async () => {
    const tree = await listCategoryTree();
    expect(tree.curricula.map((c) => c.slug)).toEqual(["uae-moe", "saudi", "british", "american"]);
    expect(tree.curricula.map((c) => c.grades.length)).toEqual([12, 12, 13, 12]);
    const uae = tree.curricula[0];
    expect(uae?.grades.map((g) => g.slug)).toEqual(
      Array.from({ length: 12 }, (_, i) => `uae-moe-grade-${i + 1}`),
    );
    expect(uae?.grades.at(-1)?.id).toBe(sampleId(208));
    const british = tree.curricula[2];
    expect(british?.grades.find((g) => g.slug === "british-year-11")?.id).toBe(sampleId(206));
    expect(tree.curricula[1]?.grades[6]?.name).toEqual({ ar: "الصف الأول المتوسط", en: "Grade 7" });
  });

  it("has ten subjects, mathematics first", async () => {
    const { subjects } = await listCategoryTree();
    expect(subjects).toHaveLength(10);
    expect(subjects[0]).toMatchObject({ id: MATHEMATICS, slug: "mathematics" });
  });

  it("keeps the sample course links on the reused grades", async () => {
    const links = await conn
      .select()
      .from(schema.courseCategories)
      .where(eq(schema.courseCategories.categoryId, sampleId(208)));
    expect(links.map((link) => link.courseId)).toEqual([sampleId(301)]);
  });

  it("refuses a grade without a curriculum at the database", async () => {
    await expect(
      conn.insert(schema.categories).values({
        id: crypto.randomUUID(),
        type: "grade",
        slug: `loose-${unique()}`,
        nameAr: "صف",
        nameEn: "Grade",
      }),
    ).rejects.toThrow();
  });
});

describe("createCategory", () => {
  it("creates a subject last, with a slug from the English name, audit-logged", async () => {
    const word = unique();
    const result = await createCategory({
      actorId: admin.id,
      type: "subject",
      parentId: null,
      nameAr: ` ${RLO}الجيولوجيا `,
      nameEn: `Geology ${word}`,
      slug: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await conn
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, result.id));
    expect(row).toMatchObject({
      type: "subject",
      slug: `geology-${word}`,
      nameAr: "الجيولوجيا",
      parentId: null,
      isSample: false,
    });
    const { subjects } = await listCategoryTree();
    expect(subjects.at(-1)?.id).toBe(result.id);
    const [audit] = await auditFor("category.created", result.id);
    expect(audit?.actorId).toBe(admin.id);
    expect(audit?.after).toMatchObject({ type: "subject", slug: `geology-${word}` });
  });

  it("prefixes a grade slug with its curriculum and nests it", async () => {
    const curriculum = await newCurriculum();
    const grade = await newGrade(curriculum, "12");
    const [parent] = await conn
      .select({ slug: schema.categories.slug })
      .from(schema.categories)
      .where(eq(schema.categories.id, curriculum));
    const [row] = await conn
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, grade));
    expect(row?.slug).toBe(`${parent?.slug}-grade-12`);
    const tree = await listCategoryTree();
    expect(tree.curricula.find((c) => c.id === curriculum)?.grades.map((g) => g.id)).toEqual([
      grade,
    ]);
  });

  it.each([
    ["a grade without a parent", "grade", null],
    ["a grade under a subject", "grade", MATHEMATICS],
    ["a subject with a parent", "subject", UAE_MOE],
    ["a grade under a missing parent", "grade", crypto.randomUUID()],
  ] as const)("refuses %s", async (_label, type, parentId) => {
    const result = await createCategory({
      actorId: admin.id,
      type,
      parentId,
      nameAr: "اسم",
      nameEn: `Name ${unique()}`,
      slug: "",
    });
    expect(result).toEqual({ ok: false, reason: "parent_invalid" });
  });

  it("refuses a taken slug", async () => {
    const result = await createCategory({
      actorId: admin.id,
      type: "subject",
      parentId: null,
      nameAr: "رياضيات",
      nameEn: "Mathematics",
      slug: "",
    });
    expect(result).toEqual({ ok: false, reason: "slug_taken" });
  });

  it("reports field errors for bad names and slugs", async () => {
    const result = await createCategory({
      actorId: admin.id,
      type: "subject",
      parentId: null,
      nameAr: "  ",
      nameEn: "Art",
      slug: "Not A Slug",
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      fields: {
        nameAr: "categories.errors.nameArRequired",
        slug: "categories.errors.slugInvalid",
      },
    });
  });

  it("asks for a slug when the English name gives none", async () => {
    const result = await createCategory({
      actorId: admin.id,
      type: "subject",
      parentId: null,
      nameAr: "فن",
      nameEn: "؟؟",
      slug: "",
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      fields: { slug: "categories.errors.slugRequired" },
    });
  });
});

describe("updateCategory", () => {
  it("renames, keeps the slug and audits before and after", async () => {
    const curriculum = await newCurriculum();
    const [before] = await conn
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, curriculum));
    const result = await updateCategory({
      actorId: admin.id,
      id: curriculum,
      nameAr: "منهج جديد",
      nameEn: "New name",
    });
    expect(result).toEqual({ ok: true });
    const [after] = await conn
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, curriculum));
    expect(after).toMatchObject({ nameAr: "منهج جديد", nameEn: "New name", slug: before?.slug });
    const [audit] = await auditFor("category.updated", curriculum);
    expect(audit?.before).toEqual({ nameAr: before?.nameAr, nameEn: before?.nameEn });
    expect(audit?.after).toEqual({ nameAr: "منهج جديد", nameEn: "New name" });
  });

  it("returns not_found and invalid", async () => {
    expect(
      await updateCategory({
        actorId: admin.id,
        id: crypto.randomUUID(),
        nameAr: "a",
        nameEn: "b",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await updateCategory({ actorId: admin.id, id: MATHEMATICS, nameAr: "a", nameEn: "" }),
    ).toEqual({
      ok: false,
      reason: "invalid",
      fields: { nameEn: "categories.errors.nameEnRequired" },
    });
  });
});

describe("moveCategory", () => {
  it("swaps with the neighbour among siblings only, audit-logged", async () => {
    const curriculum = await newCurriculum();
    const g1 = await newGrade(curriculum, "1");
    const g2 = await newGrade(curriculum, "2");
    const g3 = await newGrade(curriculum, "3");
    const order = async () =>
      (await listCategoryTree()).curricula
        .find((c) => c.id === curriculum)
        ?.grades.map((g) => g.id);

    expect(await moveCategory({ actorId: admin.id, id: g3, direction: "up" })).toEqual({
      ok: true,
      moved: true,
    });
    expect(await order()).toEqual([g1, g3, g2]);
    expect(await moveCategory({ actorId: admin.id, id: g1, direction: "up" })).toEqual({
      ok: true,
      moved: false,
    });
    expect(await moveCategory({ actorId: admin.id, id: g1, direction: "down" })).toEqual({
      ok: true,
      moved: true,
    });
    expect(await order()).toEqual([g3, g1, g2]);
    expect(await auditFor("category.moved", g3)).toHaveLength(1);
  });

  it("returns not_found for an unknown id", async () => {
    expect(
      await moveCategory({ actorId: admin.id, id: crypto.randomUUID(), direction: "up" }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("deleteCategory", () => {
  it("deletes an unused category, audit-logged", async () => {
    const curriculum = await newCurriculum();
    expect(await deleteCategory({ actorId: admin.id, id: curriculum })).toEqual({ ok: true });
    const rows = await conn
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, curriculum));
    expect(rows).toHaveLength(0);
    const [audit] = await auditFor("category.deleted", curriculum);
    expect(audit?.before).toMatchObject({ type: "curriculum" });
  });

  it("refuses a category a course uses", async () => {
    expect(await deleteCategory({ actorId: admin.id, id: MATHEMATICS })).toEqual({
      ok: false,
      reason: "in_use",
    });
  });

  it("refuses a curriculum that still has grades", async () => {
    const curriculum = await newCurriculum();
    await newGrade(curriculum, "5");
    expect(await deleteCategory({ actorId: admin.id, id: curriculum })).toEqual({
      ok: false,
      reason: "in_use",
    });
  });

  it("returns not_found for an unknown id", async () => {
    expect(await deleteCategory({ actorId: admin.id, id: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("listCategoriesForAdmin", () => {
  it("shows course counts and the sample flag", async () => {
    const list = await listCategoriesForAdmin();
    const maths = list.subjects.find((s) => s.id === MATHEMATICS);
    expect(maths).toMatchObject({ isSample: true, courseCount: 1 });
    const uae = list.curricula.find((c) => c.id === UAE_MOE);
    expect(uae?.grades).toHaveLength(12);
  });
});

describe("hidden samples", () => {
  it("leaves only real categories in the public tree, and all of them in the admin list", async () => {
    const curriculum = await newCurriculum();
    await conn
      .update(schema.platformSettings)
      .set({ sampleHiddenAt: new Date() })
      .where(eq(schema.platformSettings.id, 1));
    try {
      const tree = await listCategoryTree();
      expect(tree.subjects.some((s) => s.id === MATHEMATICS)).toBe(false);
      expect(tree.curricula.some((c) => c.id === UAE_MOE)).toBe(false);
      expect(tree.curricula.some((c) => c.id === curriculum)).toBe(true);
      const list = await listCategoriesForAdmin();
      expect(list.subjects.some((s) => s.id === MATHEMATICS)).toBe(true);
    } finally {
      await conn
        .update(schema.platformSettings)
        .set({ sampleHiddenAt: null })
        .where(eq(schema.platformSettings.id, 1));
    }
  });
});
