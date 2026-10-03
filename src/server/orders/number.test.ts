import { describe, expect, it } from "vitest";
import {
  formatOrderNumber,
  generateOrderNumber,
  ORDER_NUMBER_ALPHABET,
  parseOrderNumber,
} from "./number";

describe("order number", () => {
  it("uses the 32-symbol Crockford alphabet without I, L, O, U", () => {
    expect(ORDER_NUMBER_ALPHABET).toHaveLength(32);
    expect(new Set(ORDER_NUMBER_ALPHABET).size).toBe(32);
    for (const banned of ["I", "L", "O", "U"]) {
      expect(ORDER_NUMBER_ALPHABET).not.toContain(banned);
    }
  });

  it("generates 8 characters from the alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOrderNumber()).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    }
  });

  it("maps injected random bytes to symbols (byte mod 32)", () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(generateOrderNumber(() => bytes)).toBe("01234567");
    const high = Uint8Array.from([255, 254, 253, 252, 251, 250, 249, 248]);
    expect(generateOrderNumber(() => high)).toBe("ZYXWVTSR");
  });

  it("shows XXXX-XXXX and parses it back", () => {
    expect(formatOrderNumber("ABCD1234")).toBe("ABCD-1234");
    expect(parseOrderNumber("abcd-1234")).toBe("ABCD1234");
    expect(parseOrderNumber("ABCD1234")).toBe("ABCD1234");
  });

  it("rejects numbers of the wrong length or alphabet", () => {
    expect(parseOrderNumber("ABC-123")).toBeNull();
    expect(parseOrderNumber("ABCD-123I")).toBeNull();
    expect(parseOrderNumber("")).toBeNull();
  });
});
