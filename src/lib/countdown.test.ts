import { describe, expect, it } from "vitest";
import { formatCountdown } from "./countdown";

describe("formatCountdown", () => {
  it("formats minutes and zero-padded seconds with Latin digits, rounding up", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(59_001)).toBe("1:00");
    expect(formatCountdown(9 * 60_000 + 42_000)).toBe("9:42");
    expect(formatCountdown(15 * 60_000)).toBe("15:00");
  });
});
