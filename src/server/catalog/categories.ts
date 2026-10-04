import "server-only";
import { and, asc, count, eq, isNull, max, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { writeAudit } from "@/server/audit/repository";
import { type DbExecutor, db } from "@/server/db";
import { isForeignKeyViolation, isUniqueViolation } from "@/server/db/errors";
import { categories, courseCategories } from "@/server/db/schema";
import { categoryNamesInput, slugInput, slugify } from "./category-input";
import type { CatalogCategory, CategoryType } from "./types";
import { sampleVisible } from "./visibility";

// The category taxonomy (C3): curricula with their grades, and subjects. Admin writes are
// audit-logged in the same transaction. A grade's parent is a curriculum (the database checks
// only that a grade has a parent, and that nothing else does).

export type CategoryTree<T extends CatalogCategory = CatalogCategory> = {
  curricula: Array<T & { grades: T[] }>;
  subjects: T[];
};

export type AdminCategory = CatalogCategory & { isSample: boolean; courseCount: number };

const columns = {
  id: categories.id,
  type: categories.type,
  slug: categories.slug,
  nameAr: categories.nameAr,
  nameEn: categories.nameEn,
  parentId: categories.parentId,
  isSample: categories.isSample,
};

const order = [asc(categories.sort), asc(categories.slug)] as const;

function toCategory(row: {
  id: string;
  type: CategoryType;
  slug: string;
  nameAr: string;
  nameEn: string;
}): CatalogCategory {
  return { id: row.id, type: row.type, slug: row.slug, name: { ar: row.nameAr, en: row.nameEn } };
}

/** Groups ordered rows into the tree; a grade whose curriculum is not in the list is left out. */
function buildTree<T extends CatalogCategory>(
  rows: Array<{ node: T; parentId: string | null }>,
): CategoryTree<T> {
  const curricula = rows
    .filter((row) => row.node.type === "curriculum")
    .map((row) => ({ ...row.node, grades: [] as T[] }));
  const byId = new Map(curricula.map((curriculum) => [curriculum.id, curriculum]));
  for (const row of rows) {
    if (row.node.type === "grade" && row.parentId) byId.get(row.parentId)?.grades.push(row.node);
  }
  const subjects = rows.filter((row) => row.node.type === "subject").map((row) => row.node);
  return { curricula, subjects };
}

/** The visible taxonomy in order, for pickers and catalogue filters (sample rows follow the switch). */
export async function listCategoryTree(executor: DbExecutor = db()): Promise<CategoryTree> {
  const rows = await executor
    .select(columns)
    .from(categories)
    .where(sampleVisible(categories.isSample))
    .orderBy(...order);
  return buildTree(rows.map((row) => ({ node: toCategory(row), parentId: row.parentId })));
}

/** Every category (sample ones too) with how many courses use it, for the admin page. */
export async function listCategoriesForAdmin(): Promise<CategoryTree<AdminCategory>> {
  const usage = db()
    .select({ categoryId: courseCategories.categoryId, n: count().as("n") })
    .from(courseCategories)
    .groupBy(courseCategories.categoryId)
    .as("usage");
  const rows = await db()
    .select({ ...columns, courseCount: sql<number>`coalesce(${usage.n}, 0)::int` })
    .from(categories)
    .leftJoin(usage, eq(usage.categoryId, categories.id))
    .orderBy(...order);
  return buildTree(
    rows.map((row) => ({
      node: { ...toCategory(row), isSample: row.isSample, courseCount: row.courseCount },
      parentId: row.parentId,
    })),
  );
}

type FieldName = "nameAr" | "nameEn" | "slug";
type Invalid = { ok: false; reason: "invalid"; fields: Partial<Record<FieldName, string>> };

function parseNames(input: { nameAr: string; nameEn: string }) {
  const parsed = categoryNamesInput.safeParse(input);
  if (parsed.success) return { ok: true as const, names: parsed.data };
  const fields: Partial<Record<FieldName, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "nameAr" || field === "nameEn") && !fields[field]) fields[field] = issue.message;
  }
  return { ok: false as const, fields };
}

export type CreateCategoryResult =
  | { ok: true; id: string }
  | Invalid
  | { ok: false; reason: "parent_invalid" | "slug_taken" };

/**
 * Adds a category at the end of its siblings. A grade needs a curriculum parent; curricula and
 * subjects have none. The slug, when left empty, comes from the English name (a grade's is
 * prefixed with its curriculum's), and never changes afterwards.
 */
export async function createCategory(input: {
  actorId: string;
  type: CategoryType;
  parentId: string | null;
  nameAr: string;
  nameEn: string;
  slug: string;
}): Promise<CreateCategoryResult> {
  const names = parseNames(input);
  const typed = input.slug.trim();
  const slugError =
    typed && !slugInput.safeParse(typed).success ? "categories.errors.slugInvalid" : null;
  if (!names.ok || slugError) {
    return {
      ok: false,
      reason: "invalid",
      fields: { ...(names.ok ? {} : names.fields), ...(slugError ? { slug: slugError } : {}) },
    };
  }
  const isGrade = input.type === "grade";
  if (isGrade !== (input.parentId !== null)) return { ok: false, reason: "parent_invalid" };

  try {
    return await db().transaction(async (tx) => {
      let prefix = "";
      if (input.parentId) {
        // Locked so the curriculum cannot be deleted while its new grade is added.
        const [parent] = await tx
          .select({ type: categories.type, slug: categories.slug })
          .from(categories)
          .where(eq(categories.id, input.parentId))
          .for("update");
        if (parent?.type !== "curriculum") return { ok: false, reason: "parent_invalid" } as const;
        prefix = `${parent.slug}-`;
      }
      const slug = typed || slugify(`${prefix}${slugify(names.names.nameEn)}`);
      if (!slug || slug === slugify(prefix)) {
        return {
          ok: false,
          reason: "invalid",
          fields: { slug: "categories.errors.slugRequired" },
        } as const;
      }
      const [last] = await tx
        .select({ sort: max(categories.sort) })
        .from(categories)
        .where(siblingsOf(input.type, input.parentId));
      const id = uuidv7();
      const values = {
        id,
        type: input.type,
        parentId: input.parentId,
        slug,
        nameAr: names.names.nameAr,
        nameEn: names.names.nameEn,
        sort: (last?.sort ?? 0) + 1,
      };
      await tx.insert(categories).values(values);
      await writeAudit(tx, {
        actorId: input.actorId,
        action: "category.created",
        subjectType: "category",
        subjectId: id,
        after: values,
      });
      return { ok: true, id } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "slug_taken" };
    throw error;
  }
}

function siblingsOf(type: CategoryType, parentId: string | null) {
  return and(
    eq(categories.type, type),
    parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId),
  );
}

export type UpdateCategoryResult = { ok: true } | Invalid | { ok: false; reason: "not_found" };

/** Renames a category (both languages). The slug stays: it is in catalogue links. */
export async function updateCategory(input: {
  actorId: string;
  id: string;
  nameAr: string;
  nameEn: string;
}): Promise<UpdateCategoryResult> {
  const names = parseNames(input);
  if (!names.ok) return { ok: false, reason: "invalid", fields: names.fields };
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select({ nameAr: categories.nameAr, nameEn: categories.nameEn })
      .from(categories)
      .where(eq(categories.id, input.id))
      .for("update");
    if (!row) return { ok: false, reason: "not_found" } as const;
    await tx.update(categories).set(names.names).where(eq(categories.id, input.id));
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "category.updated",
      subjectType: "category",
      subjectId: input.id,
      before: row,
      after: names.names,
    });
    return { ok: true } as const;
  });
}

export type MoveCategoryResult = { ok: true; moved: boolean } | { ok: false; reason: "not_found" };

/**
 * Moves a category one place up or down among its siblings. The siblings are locked and
 * renumbered 1..n, so equal sort values (old data, concurrent adds) cannot make a swap a no-op.
 */
export async function moveCategory(input: {
  actorId: string;
  id: string;
  direction: "up" | "down";
}): Promise<MoveCategoryResult> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select({ type: categories.type, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, input.id));
    if (!row) return { ok: false, reason: "not_found" } as const;
    const siblings = await tx
      .select({ id: categories.id, sort: categories.sort })
      .from(categories)
      .where(siblingsOf(row.type, row.parentId))
      .orderBy(...order, asc(categories.id))
      .for("update");
    const from = siblings.findIndex((sibling) => sibling.id === input.id);
    const to = input.direction === "up" ? from - 1 : from + 1;
    if (from < 0) return { ok: false, reason: "not_found" } as const;
    if (to < 0 || to >= siblings.length) return { ok: true, moved: false } as const;
    const ids = siblings.map((sibling) => sibling.id);
    [ids[from], ids[to]] = [ids[to] as string, ids[from] as string];
    await renumber(tx, ids, siblings);
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "category.moved",
      subjectType: "category",
      subjectId: input.id,
      before: { position: from + 1 },
      after: { position: to + 1 },
    });
    return { ok: true, moved: true } as const;
  });
}

async function renumber(
  tx: DbExecutor,
  ids: string[],
  current: Array<{ id: string; sort: number }>,
): Promise<void> {
  const sorts = new Map(current.map((row) => [row.id, row.sort]));
  for (const [index, id] of ids.entries()) {
    if (sorts.get(id) !== index + 1) {
      await tx
        .update(categories)
        .set({ sort: index + 1 })
        .where(eq(categories.id, id));
    }
  }
}

export type DeleteCategoryResult = { ok: true } | { ok: false; reason: "not_found" | "in_use" };

/**
 * Deletes a category nothing uses. A course link or a grade under a curriculum makes it
 * `in_use`; the foreign keys restrict too, so a link added concurrently fails the delete
 * instead of being removed with it.
 */
export async function deleteCategory(input: {
  actorId: string;
  id: string;
}): Promise<DeleteCategoryResult> {
  try {
    return await db().transaction(async (tx) => {
      const [row] = await tx
        .select(columns)
        .from(categories)
        .where(eq(categories.id, input.id))
        .for("update");
      if (!row) return { ok: false, reason: "not_found" } as const;
      const [links] = await tx
        .select({ n: count() })
        .from(courseCategories)
        .where(eq(courseCategories.categoryId, input.id));
      const [children] = await tx
        .select({ n: count() })
        .from(categories)
        .where(eq(categories.parentId, input.id));
      if ((links?.n ?? 0) > 0 || (children?.n ?? 0) > 0) {
        return { ok: false, reason: "in_use" } as const;
      }
      await tx.delete(categories).where(eq(categories.id, input.id));
      await writeAudit(tx, {
        actorId: input.actorId,
        action: "category.deleted",
        subjectType: "category",
        subjectId: input.id,
        before: row,
      });
      return { ok: true } as const;
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) return { ok: false, reason: "in_use" };
    throw error;
  }
}
