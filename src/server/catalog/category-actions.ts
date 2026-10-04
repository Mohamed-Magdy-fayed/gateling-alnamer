"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Dictionary } from "@/i18n/ar";
import { getDictionary } from "@/i18n/server";
import { getActingUser } from "@/server/auth/acting-user";
import { type FormState, fields } from "@/server/auth/form-kit";
import { createCategory, deleteCategory, moveCategory, updateCategory } from "./categories";

// The admin categories page (C3). Every action re-checks the acting admin (a two-factor-verified
// session; `getActingUser` is null otherwise) and refreshes the page.

const ADMIN_CATEGORIES_PATH = "/dashboard/admin/categories";

const text = z.string().max(400).default("");
const createSchema = z.object({
  type: z.enum(["curriculum", "grade", "subject"]),
  parent_id: z.union([z.uuid(), z.literal("")]).default(""),
  name_ar: text,
  name_en: text,
  slug: text,
});
const updateSchema = z.object({ id: z.uuid(), name_ar: text, name_en: text });
const moveSchema = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });
const deleteSchema = z.object({ id: z.uuid() });

type CategoriesText = Dictionary["categories"];
type ErrorKey = keyof CategoriesText["errors"];

async function actingAdmin() {
  const user = await getActingUser();
  return user?.role === "admin" ? user : null;
}

const FORM_FIELDS = { nameAr: "name_ar", nameEn: "name_en", slug: "slug" } as const;

/** Service field errors (dictionary keys `categories.errors.*`) as translated form field errors. */
function fieldErrors(
  texts: CategoriesText["errors"],
  fallback: string,
  errors: Partial<Record<keyof typeof FORM_FIELDS, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, key] of Object.entries(errors)) {
    const leaf = key?.split(".").at(-1) as ErrorKey | undefined;
    out[FORM_FIELDS[field as keyof typeof FORM_FIELDS]] = (leaf && texts[leaf]) || fallback;
  }
  return out;
}

function values(raw: Record<string, unknown>, keys: string[]): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => (typeof raw[key] === "string" ? [[key, raw[key] as string]] : [])),
  );
}

/** Adds a curriculum, a grade (under `parent_id`) or a subject. */
export async function createCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await actingAdmin();
  if (!admin) redirect("/dashboard");
  const { t } = await getDictionary();
  const a = t.categories.admin;
  const raw = fields(formData);
  const echoed = values(raw, ["name_ar", "name_en", "slug"]);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: a.error, values: echoed };
  const input = parsed.data;
  const result = await createCategory({
    actorId: admin.id,
    type: input.type,
    parentId: input.parent_id || null,
    nameAr: input.name_ar,
    nameEn: input.name_en,
    slug: input.slug,
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      return {
        status: "error",
        message: t.auth.errors.invalid,
        fieldErrors: fieldErrors(t.categories.errors, a.error, result.fields),
        values: echoed,
      };
    }
    if (result.reason === "slug_taken") {
      return {
        status: "error",
        message: t.auth.errors.invalid,
        fieldErrors: { slug: a.slugTaken },
        values: echoed,
      };
    }
    // The curriculum went away meanwhile: refresh so the form goes with it.
    revalidatePath(ADMIN_CATEGORIES_PATH);
    return { status: "error", message: a.parentInvalid, values: echoed };
  }
  revalidatePath(ADMIN_CATEGORIES_PATH);
  return { status: "success", message: a.created };
}

/** Renames a category in both languages (the slug stays). */
export async function updateCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await actingAdmin();
  if (!admin) redirect("/dashboard");
  const { t } = await getDictionary();
  const a = t.categories.admin;
  const raw = fields(formData);
  const echoed = values(raw, ["name_ar", "name_en"]);
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: a.error, values: echoed };
  const result = await updateCategory({
    actorId: admin.id,
    id: parsed.data.id,
    nameAr: parsed.data.name_ar,
    nameEn: parsed.data.name_en,
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      return {
        status: "error",
        message: t.auth.errors.invalid,
        fieldErrors: fieldErrors(t.categories.errors, a.error, result.fields),
        values: echoed,
      };
    }
    revalidatePath(ADMIN_CATEGORIES_PATH);
    return { status: "error", message: a.notFound };
  }
  revalidatePath(ADMIN_CATEGORIES_PATH);
  return { status: "success", message: a.saved };
}

/** Moves a category one place among its siblings. Success needs no message: the list shows it. */
export async function moveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actingAdmin();
  if (!admin) redirect("/dashboard");
  const { t } = await getDictionary();
  const a = t.categories.admin;
  const parsed = moveSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: a.error };
  const result = await moveCategory({ actorId: admin.id, ...parsed.data });
  revalidatePath(ADMIN_CATEGORIES_PATH);
  if (!result.ok) return { status: "error", message: a.notFound };
  return { status: "idle" };
}

/** Deletes an unused category; the notice shows at the top since the row is gone. */
export async function deleteCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await actingAdmin();
  if (!admin) redirect("/dashboard");
  const { t } = await getDictionary();
  const a = t.categories.admin;
  const parsed = deleteSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: a.error };
  const result = await deleteCategory({ actorId: admin.id, id: parsed.data.id });
  if (!result.ok) {
    if (result.reason === "in_use") return { status: "error", message: a.inUse };
    revalidatePath(ADMIN_CATEGORIES_PATH);
    return { status: "error", message: a.notFound };
  }
  revalidatePath(ADMIN_CATEGORIES_PATH);
  redirect(`${ADMIN_CATEGORIES_PATH}?done=deleted`);
}
