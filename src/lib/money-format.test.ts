import { describe, expect, it } from "vitest";
import { formatPrice } from "./money-format";

describe("formatPrice", () => {
  it("formats minor units in English", () => {
    expect(formatPrice("en", 45000, "AED")).toBe("450 AED");
    expect(formatPrice("en", 12550, "AED")).toBe("125.5 AED");
  });

  it("uses Latin digits in Arabic", () => {
    expect(formatPrice("ar", 45000, "د.إ")).toBe("450 د.إ");
  });

  it("groups thousands", () => {
    expect(formatPrice("en", 123456700, "AED")).toBe("1,234,567 AED");
  });
});
