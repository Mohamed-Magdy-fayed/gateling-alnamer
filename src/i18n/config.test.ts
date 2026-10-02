import { describe, expect, it } from "vitest";
import {
  defaultLocale,
  dirOf,
  format,
  formatCount,
  formatDate,
  formatNumber,
  isLocale,
} from "./config";

const ARABIC_INDIC_DIGITS = /[٠-٩]/;

describe("locale helpers", () => {
  it("defaults to Arabic", () => {
    expect(defaultLocale).toBe("ar");
  });

  it("isLocale accepts only ar and en", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("dirOf is rtl for Arabic and ltr for English", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
  });
});

describe("format", () => {
  it("replaces placeholders, numbers included", () => {
    expect(format("{name} has {count} items", { name: "Sara", count: 3 })).toBe("Sara has 3 items");
  });

  it("keeps unknown placeholders", () => {
    expect(format("Hi {name} {missing}", { name: "Sara" })).toBe("Hi Sara {missing}");
  });
});

describe("formatNumber", () => {
  it("uses Latin digits in Arabic", () => {
    const out = formatNumber("ar", 1234.5);
    expect(out).toMatch(/1/);
    expect(out).toMatch(/234/);
    expect(out).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it("formats English with grouping and at most two decimals", () => {
    expect(formatNumber("en", 1234.5678)).toBe("1,234.57");
  });
});

describe("formatDate", () => {
  const date = new Date(2026, 9, 1, 12);

  it("uses the Gregorian calendar with Latin digits in Arabic", () => {
    const out = formatDate("ar", date);
    expect(out).toContain("2026");
    expect(out).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it("formats English as day month year", () => {
    expect(formatDate("en", date)).toBe("1 October 2026");
  });
});

describe("formatCount", () => {
  const forms = { one: "one", two: "two", few: "{count} few", many: "{count} many" };

  it("picks the Arabic forms 1 / 2 / 3-10 / 11+", () => {
    expect(formatCount("ar", forms, 1)).toBe("one");
    expect(formatCount("ar", forms, 2)).toBe("two");
    expect(formatCount("ar", forms, 3)).toBe("3 few");
    expect(formatCount("ar", forms, 10)).toBe("10 few");
    expect(formatCount("ar", forms, 11)).toBe("11 many");
    expect(formatCount("ar", forms, 0)).toBe("0 many");
  });

  it("uses only one / other in English", () => {
    expect(formatCount("en", forms, 1)).toBe("one");
    expect(formatCount("en", forms, 2)).toBe("2 many");
    expect(formatCount("en", forms, 5)).toBe("5 many");
  });
});
