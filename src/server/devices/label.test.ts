import { describe, expect, it } from "vitest";
import { deviceLabel } from "./label";

describe("deviceLabel", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Chrome on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/127.0",
      "Firefox on macOS",
    ],
  ])("reads %#", (ua, expected) => {
    expect(deviceLabel(ua)).toBe(expected);
  });

  it("is null when nothing is recognised", () => {
    expect(deviceLabel(null)).toBeNull();
    expect(deviceLabel("")).toBeNull();
    expect(deviceLabel("curl/8.0")).toBeNull();
  });

  it("uses only the browser when the OS is unknown, and caps at 80 chars", () => {
    expect(deviceLabel("Firefox/127.0")).toBe("Firefox");
    expect(deviceLabel(`Chrome/1 ${"x".repeat(500)}`)?.length ?? 0).toBeLessThanOrEqual(80);
  });
});
