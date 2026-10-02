import { describe, expect, it } from "vitest";
import { cairoDay } from "./day";

describe("cairoDay", () => {
  it("is the Cairo calendar day as YYYY-MM-DD", () => {
    expect(cairoDay(new Date("2030-03-01T09:00:00.000Z"))).toBe("2030-03-01");
  });

  it("rolls over at Cairo midnight, not UTC midnight", () => {
    expect(cairoDay(new Date("2030-03-01T21:59:59.000Z"))).toBe("2030-03-01");
    expect(cairoDay(new Date("2030-03-01T22:00:00.000Z"))).toBe("2030-03-02");
  });
});
