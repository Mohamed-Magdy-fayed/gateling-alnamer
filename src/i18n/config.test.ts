import { describe, expect, it } from "vitest";
import { ar } from "./ar";
import {
  defaultLocale,
  dirOf,
  format,
  formatDate,
  formatNumber,
  formatTime,
  isLocale,
  plural,
} from "./config";
import { en } from "./en";

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

  it("uses the Cairo calendar day whatever the server's zone", () => {
    const lateUtc = new Date("2030-03-01T22:30:00.000Z"); // 00:30 on 2 March in Cairo
    expect(formatDate("en", lateUtc)).toBe("2 March 2030");
    expect(formatDate("ar", lateUtc)).toContain("2");
  });
});

describe("formatTime", () => {
  const date = new Date("2030-01-01T10:45:00.000Z");

  it("uses Latin digits in Arabic and the Cairo clock", () => {
    const out = formatTime("ar", date);
    expect(out).toMatch(/12:45/);
    expect(out).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it("formats English hours and minutes", () => {
    expect(formatTime("en", date)).toMatch(/12:45/);
  });
});

describe("plural", () => {
  const arForms = {
    zero: "zero",
    one: "one",
    two: "two",
    few: "{count} few",
    many: "{count} many",
    other: "{count} other",
  };
  const enForms = { one: "{count} item", other: "{count} items" };

  it("picks the Arabic category for 0, 1, 2, 3, 10, 11, 99, 100, 101", () => {
    const expected: [number, string][] = [
      [0, "zero"],
      [1, "one"],
      [2, "two"],
      [3, "3 few"],
      [10, "10 few"],
      [11, "11 many"],
      [99, "99 many"],
      [100, "100 other"],
      [101, "101 other"],
    ];
    for (const [n, out] of expected) expect(plural("ar", arForms, n)).toBe(out);
  });

  it("picks one / other in English", () => {
    expect(plural("en", enForms, 1)).toBe("1 item");
    expect(plural("en", enForms, 0)).toBe("0 items");
    expect(plural("en", enForms, 2)).toBe("2 items");
    expect(plural("en", enForms, 42)).toBe("42 items");
  });

  it("renders numbers with Latin digits", () => {
    expect(plural("ar", arForms, 1000)).toBe("1,000 other");
    expect(plural("ar", arForms, 5)).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it("reads correctly with the student-count key", () => {
    const forms = (locale: "ar" | "en") =>
      (locale === "ar" ? ar : en).dashboard.teacher.studentsCount;
    expect(plural("ar", forms("ar"), 0)).toBe("لا طلاب");
    expect(plural("ar", forms("ar"), 1)).toBe("طالب واحد");
    expect(plural("ar", forms("ar"), 2)).toBe("طالبان");
    expect(plural("ar", forms("ar"), 3)).toBe("3 طلاب");
    expect(plural("ar", forms("ar"), 11)).toBe("11 طالبًا");
    expect(plural("ar", forms("ar"), 100)).toBe("100 طالب");
    expect(plural("en", forms("en"), 1)).toBe("1 student");
    expect(plural("en", forms("en"), 42)).toBe("42 students");
  });
});
