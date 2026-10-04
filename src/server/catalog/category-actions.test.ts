import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";

const ID = "0192f0e2-7c3a-7b4e-9a1d-3f5e6a7b8c9d";
const PATH = "/dashboard/admin/categories";

type Result = { ok: true; id?: string; moved?: boolean } | Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  calls: [] as Array<[string, unknown]>,
  result: { ok: true } as Result,
  revalidated: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    h.revalidated.push(path);
  },
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({ t: en, locale: "en" as const }),
}));
vi.mock("@/server/auth/acting-user", () => ({ getActingUser: async () => h.user }));
vi.mock("@/server/auth/form-kit", () => ({
  fields: (formData: FormData) => Object.fromEntries(formData.entries()),
}));
vi.mock("./categories", () => {
  const record = (name: string) => async (input: unknown) => {
    h.calls.push([name, input]);
    return h.result;
  };
  return {
    createCategory: record("create"),
    updateCategory: record("update"),
    moveCategory: record("move"),
    deleteCategory: record("delete"),
  };
});

const { createCategoryAction, deleteCategoryAction, moveCategoryAction, updateCategoryAction } =
  await import("./category-actions");

const idle = { status: "idle" as const };
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const a = en.categories.admin;

beforeEach(() => {
  h.user = { id: "admin-1", role: "admin" };
  h.calls = [];
  h.result = { ok: true };
  h.revalidated = [];
});

describe("every category action", () => {
  it.each([
    ["create", () => createCategoryAction(idle, form({ type: "subject" }))],
    ["update", () => updateCategoryAction(idle, form({ id: ID }))],
    ["move", () => moveCategoryAction(idle, form({ id: ID, direction: "up" }))],
    ["delete", () => deleteCategoryAction(idle, form({ id: ID }))],
  ])("%s sends a non-admin away without calling the service", async (_name, run) => {
    h.user = { id: "teacher-1", role: "teacher" };
    await expect(run()).rejects.toThrow("redirect:/dashboard");
    expect(h.calls).toEqual([]);
  });
});

describe("createCategoryAction", () => {
  it("creates a grade under its curriculum and refreshes the page", async () => {
    h.result = { ok: true, id: ID };
    const state = await createCategoryAction(
      idle,
      form({ type: "grade", parent_id: ID, name_ar: "الصف", name_en: "Grade 1", slug: "" }),
    );
    expect(state).toEqual({ status: "success", message: a.created });
    expect(h.calls).toEqual([
      [
        "create",
        {
          actorId: "admin-1",
          type: "grade",
          parentId: ID,
          nameAr: "الصف",
          nameEn: "Grade 1",
          slug: "",
        },
      ],
    ]);
    expect(h.revalidated).toEqual([PATH]);
  });

  it("passes no parent for an empty parent_id", async () => {
    await createCategoryAction(idle, form({ type: "subject", parent_id: "", name_ar: "x" }));
    expect(h.calls[0]?.[1]).toMatchObject({ parentId: null });
  });

  it("translates field errors and echoes the input", async () => {
    h.result = {
      ok: false,
      reason: "invalid",
      fields: { nameAr: "categories.errors.nameArRequired", slug: "categories.errors.slugInvalid" },
    };
    const state = await createCategoryAction(
      idle,
      form({ type: "subject", name_ar: "", name_en: "Art", slug: "Bad Slug" }),
    );
    expect(state).toEqual({
      status: "error",
      message: en.auth.errors.invalid,
      fieldErrors: {
        name_ar: en.categories.errors.nameArRequired,
        slug: en.categories.errors.slugInvalid,
      },
      values: { name_ar: "", name_en: "Art", slug: "Bad Slug" },
    });
  });

  it("puts a taken slug on the slug field", async () => {
    h.result = { ok: false, reason: "slug_taken" };
    const state = await createCategoryAction(idle, form({ type: "subject", name_en: "Maths" }));
    expect(state.fieldErrors).toEqual({ slug: a.slugTaken });
  });

  it("refuses an unknown type without calling the service", async () => {
    const state = await createCategoryAction(idle, form({ type: "country" }));
    expect(state).toMatchObject({ status: "error", message: a.error });
    expect(h.calls).toEqual([]);
  });
});

describe("over the hourly limit", () => {
  it.each([
    ["create", () => createCategoryAction(idle, form({ type: "subject", name_en: "Art" }))],
    ["update", () => updateCategoryAction(idle, form({ id: ID, name_ar: "a", name_en: "b" }))],
    ["move", () => moveCategoryAction(idle, form({ id: ID, direction: "up" }))],
    ["delete", () => deleteCategoryAction(idle, form({ id: ID }))],
  ])("%s explains the limit as a warning", async (_name, run) => {
    h.result = { ok: false, reason: "rate_limited" };
    expect(await run()).toMatchObject({ status: "error", tone: "warning", message: a.limited });
  });
});

describe("updateCategoryAction", () => {
  it("saves and refreshes", async () => {
    const state = await updateCategoryAction(
      idle,
      form({ id: ID, name_ar: "رياضيات", name_en: "Maths" }),
    );
    expect(state).toEqual({ status: "success", message: a.saved });
    expect(h.calls[0]?.[1]).toEqual({
      actorId: "admin-1",
      id: ID,
      nameAr: "رياضيات",
      nameEn: "Maths",
    });
  });

  it("reports a category that went away", async () => {
    h.result = { ok: false, reason: "not_found" };
    const state = await updateCategoryAction(idle, form({ id: ID, name_ar: "a", name_en: "b" }));
    expect(state).toEqual({ status: "error", message: a.notFound });
    expect(h.revalidated).toEqual([PATH]);
  });
});

describe("moveCategoryAction", () => {
  it("moves quietly", async () => {
    h.result = { ok: true, moved: true };
    expect(await moveCategoryAction(idle, form({ id: ID, direction: "down" }))).toEqual({
      status: "success",
    });
    expect(h.calls[0]?.[1]).toEqual({ actorId: "admin-1", id: ID, direction: "down" });
  });

  it("refuses a bad direction", async () => {
    const state = await moveCategoryAction(idle, form({ id: ID, direction: "left" }));
    expect(state).toEqual({ status: "error", message: a.error });
    expect(h.calls).toEqual([]);
  });
});

describe("deleteCategoryAction", () => {
  it("redirects with the deleted notice", async () => {
    await expect(deleteCategoryAction(idle, form({ id: ID }))).rejects.toThrow(
      `redirect:${PATH}?done=deleted`,
    );
  });

  it("explains a category in use", async () => {
    h.result = { ok: false, reason: "in_use" };
    expect(await deleteCategoryAction(idle, form({ id: ID }))).toEqual({
      status: "error",
      message: a.inUse,
    });
  });
});
