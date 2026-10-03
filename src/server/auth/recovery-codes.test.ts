import { describe, expect, it } from "vitest";
import { newRecoveryCodes, normalizeRecoveryCode } from "./recovery-codes";

describe("recovery codes", () => {
  it("makes 10 distinct XXXX-XXXX Crockford codes", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("normalises case, spaces, dashes and the confusable letters", () => {
    expect(normalizeRecoveryCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeRecoveryCode(" o1l0 - i2Ab ")).toBe("0110 12AB".replace(" ", ""));
    expect(normalizeRecoveryCode("ABCD-EFG")).toBeNull();
    expect(normalizeRecoveryCode("ABCD-EFGU")).toBeNull();
  });
});
