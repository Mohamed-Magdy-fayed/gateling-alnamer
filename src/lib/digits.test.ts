import { describe, expect, it } from "vitest";
import { onlyLatinDigits } from "./digits";

describe("onlyLatinDigits", () => {
  it("keeps Latin digits and drops everything else", () => {
    expect(onlyLatinDigits("12 34-56ab")).toBe("123456");
  });

  it("maps Arabic-Indic digits to Latin", () => {
    expect(onlyLatinDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("maps Extended Arabic-Indic (Persian) digits to Latin", () => {
    expect(onlyLatinDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });

  it("handles a mixed paste and strips separators", () => {
    expect(onlyLatinDigits("١٢٣ 456")).toBe("123456");
  });
});
