import { describe, expect, it } from "vitest";
import { localizedTextSchema, pickText } from "./localized-text";

describe("pickText", () => {
  it("returns the requested language", () => {
    expect(pickText({ ar: "عربي", en: "English" }, "ar")).toBe("عربي");
    expect(pickText({ ar: "عربي", en: "English" }, "en")).toBe("English");
  });

  it("falls back to the other language", () => {
    expect(pickText({ en: "English" }, "ar")).toBe("English");
    expect(pickText({ ar: "عربي" }, "en")).toBe("عربي");
  });

  it("falls back when the requested value is empty", () => {
    expect(pickText({ ar: "", en: "English" }, "ar")).toBe("English");
  });

  it("returns an empty string when both are missing", () => {
    expect(pickText({}, "en")).toBe("");
  });
});

describe("localizedTextSchema", () => {
  it("accepts one or both languages", () => {
    expect(localizedTextSchema.safeParse({ ar: "x" }).success).toBe(true);
    expect(localizedTextSchema.safeParse({ en: "x" }).success).toBe(true);
    expect(localizedTextSchema.safeParse({ ar: "x", en: "y" }).success).toBe(true);
  });

  it("rejects an object with no non-empty key", () => {
    expect(localizedTextSchema.safeParse({}).success).toBe(false);
    expect(localizedTextSchema.safeParse({ ar: "", en: "" }).success).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(localizedTextSchema.safeParse("text").success).toBe(false);
    expect(localizedTextSchema.safeParse(null).success).toBe(false);
  });
});
