import { describe, expect, it } from "vitest";
import { draftCourseInput, priceToMinor } from "./authoring-input";

const valid = {
  titleAr: "مقدمة في الجبر",
  titleEn: "Intro to algebra",
  descriptionAr: "دورة قصيرة في أساسيات الجبر.",
  price: 150,
  accessDays: 90,
  lessonTitleAr: "الدرس الأول",
  freePreview: false,
};

describe("draftCourseInput", () => {
  it("accepts a valid draft and allows an empty English title", () => {
    expect(draftCourseInput.safeParse(valid).success).toBe(true);
    expect(draftCourseInput.safeParse({ ...valid, titleEn: "" }).success).toBe(true);
  });

  it("requires the Arabic title, description and lesson title", () => {
    for (const field of ["titleAr", "descriptionAr", "lessonTitleAr"] as const) {
      const result = draftCourseInput.safeParse({ ...valid, [field]: "" });
      expect(result.success, field).toBe(false);
    }
  });

  it("bounds title length, price and access days", () => {
    expect(draftCourseInput.safeParse({ ...valid, titleAr: "اب" }).success).toBe(false);
    expect(draftCourseInput.safeParse({ ...valid, titleAr: "ا".repeat(121) }).success).toBe(false);
    expect(draftCourseInput.safeParse({ ...valid, price: 0 }).success).toBe(false);
    expect(draftCourseInput.safeParse({ ...valid, price: 100_001 }).success).toBe(false);
    expect(draftCourseInput.safeParse({ ...valid, price: 12.5 }).success).toBe(false);
    expect(draftCourseInput.safeParse({ ...valid, accessDays: 0 }).success).toBe(false);
    expect(draftCourseInput.safeParse({ ...valid, accessDays: 366 }).success).toBe(false);
  });

  it("reports dictionary keys, never English text", () => {
    const result = draftCourseInput.safeParse({ ...valid, price: 0 });
    expect(result.success).toBe(false);
    if (result.success) return;
    for (const issue of result.error.issues) expect(issue.message).toMatch(/^teach\.errors\./);
  });
});

describe("priceToMinor", () => {
  it("converts whole units to minor units for a 2-decimal currency", () => {
    expect(priceToMinor(150)).toBe(15_000);
  });
});

describe("bidi controls", () => {
  it("strips override and isolate characters from titles", () => {
    const result = draftCourseInput.safeParse({
      ...valid,
      titleAr: "‮مقدمة⁦ في الجبر⁩",
    });
    expect(result.success && result.data.titleAr).toBe("مقدمة في الجبر");
  });
});
