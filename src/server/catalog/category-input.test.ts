import { describe, expect, it } from "vitest";
import { categoryNamesInput, slugInput, slugify } from "./category-input";

/** Right-to-left override, written as an escape so no invisible control sits in the source. */
const RLO = String.fromCharCode(0x202e);

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Computer Science")).toBe("computer-science");
  });

  it("drops accents and symbols and trims hyphens", () => {
    expect(slugify("  Économie & Gestion!  ")).toBe("economie-gestion");
  });

  it("returns an empty string when nothing Latin is left", () => {
    expect(slugify("الرياضيات")).toBe("");
  });

  it("keeps at most 60 characters without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("slugInput", () => {
  it.each(["math", "grade-12", "a1-b2"])("accepts %s", (slug) => {
    expect(slugInput.safeParse(slug).success).toBe(true);
  });

  it.each(["Math", "-math", "math-", "ma--th", "ma th", "", "x".repeat(61)])(
    "refuses %j",
    (slug) => {
      const parsed = slugInput.safeParse(slug);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe("categories.errors.slugInvalid");
    },
  );
});

describe("categoryNamesInput", () => {
  it("trims names and strips bidi controls", () => {
    const parsed = categoryNamesInput.parse({ nameAr: ` ${RLO}الرياضيات `, nameEn: " Maths " });
    expect(parsed).toEqual({ nameAr: "الرياضيات", nameEn: "Maths" });
  });

  it("requires both names", () => {
    const parsed = categoryNamesInput.safeParse({ nameAr: "  ", nameEn: "" });
    expect(parsed.success).toBe(false);
    const messages = parsed.error?.issues.map((issue) => [issue.path[0], issue.message]);
    expect(messages).toEqual([
      ["nameAr", "categories.errors.nameRequired"],
      ["nameEn", "categories.errors.nameRequired"],
    ]);
  });

  it("refuses names longer than 80 characters", () => {
    const parsed = categoryNamesInput.safeParse({ nameAr: "ع".repeat(81), nameEn: "ok" });
    expect(parsed.error?.issues[0]?.message).toBe("categories.errors.nameLength");
  });
});
