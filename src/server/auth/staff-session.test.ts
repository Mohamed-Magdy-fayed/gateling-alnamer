import { describe, expect, it } from "vitest";
import { passesTwoFactor } from "./staff-session";

const session = (
  role: "student" | "parent" | "teacher" | "admin" | "reviewer",
  verified: boolean,
) => ({
  user: { role },
  twoFactorVerified: verified,
});

describe("passesTwoFactor", () => {
  it("staff sessions pass only once verified; others always; no session never", () => {
    for (const role of ["teacher", "admin", "reviewer"] as const) {
      expect(passesTwoFactor(session(role, false), true), role).toBe(false);
      expect(passesTwoFactor(session(role, true), true), role).toBe(true);
    }
    expect(passesTwoFactor(session("student", false), true)).toBe(true);
    expect(passesTwoFactor(session("parent", false), true)).toBe(true);
    expect(passesTwoFactor(null, true)).toBe(false);
    expect(passesTwoFactor(session("admin", false), false)).toBe(true);
  });
});
