import { describe, expect, it } from "vitest";
import { defaultLocale, dirOf, format, formatDate, formatNumber, isLocale } from "./config";

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
