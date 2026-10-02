import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("keeps a same-origin relative path with its query", () => {
    expect(safeNextPath("/dashboard/learn/abc?x=1")).toBe("/dashboard/learn/abc?x=1");
  });

  it.each([
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/x",
    "http://evil.example",
    "javascript:alert(1)",
    "dashboard",
    "",
    "/ok\nSet-Cookie: a=b",
    "/\tevil",
  ])("falls back to /dashboard for %j", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("falls back for a missing value", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
  });
});
