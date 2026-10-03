import { describe, expect, it } from "vitest";
import { ar } from "@/i18n/ar";
import { en } from "@/i18n/en";
import { lessonDenial } from "./lesson-access";

describe("lessonDenial", () => {
  it("denies parents with the cannotPlay copy and lets other roles through", () => {
    expect(lessonDenial("parent")).toBe("cannotPlay");
    expect(lessonDenial("student")).toBeNull();
    expect(lessonDenial("admin")).toBeNull();
  });
  it("has the exact copy in both languages", () => {
    expect(en.parents.cannotPlay).toBe(
      "Parent accounts can't play lessons. You can follow your children's progress here.",
    );
    expect(ar.parents.cannotPlay).toBe(
      "حسابات أولياء الأمور لا تشغّل الدروس. يمكنك متابعة تقدم أبنائك من هنا.",
    );
  });
});
