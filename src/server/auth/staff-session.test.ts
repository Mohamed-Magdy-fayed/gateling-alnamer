import { afterEach, describe, expect, it } from "vitest";
import {
  isStaffRole,
  passesTwoFactor,
  setTwoFactorEnforcedForTests,
  staffSessionOrNull,
  twoFactorEnforced,
} from "./staff-session";

type Role = "student" | "parent" | "teacher" | "admin" | "reviewer";
const session = (role: Role, verified: boolean, status = "active") => ({
  user: { role, status },
  twoFactorVerified: verified,
});

afterEach(() => setTwoFactorEnforcedForTests(null));

describe("isStaffRole", () => {
  it("teacher, admin and reviewer are staff; student and parent are not", () => {
    expect(["teacher", "admin", "reviewer"].every((r) => isStaffRole(r as Role))).toBe(true);
    expect(isStaffRole("student")).toBe(false);
    expect(isStaffRole("parent")).toBe(false);
  });
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

  it("defaults to the switch, which the test hook can turn off and restore", () => {
    expect(twoFactorEnforced()).toBe(true);
    setTwoFactorEnforcedForTests(() => false);
    expect(passesTwoFactor(session("teacher", false))).toBe(true);
    setTwoFactorEnforcedForTests(null);
    expect(passesTwoFactor(session("teacher", false))).toBe(false);
  });
});

describe("staffSessionOrNull", () => {
  it("returns active staff, verified when asked; null for anyone else", () => {
    expect(staffSessionOrNull(session("teacher", false), { verified: false })).not.toBeNull();
    expect(staffSessionOrNull(session("teacher", false), { verified: true })).toBeNull();
    expect(staffSessionOrNull(session("admin", true), { verified: true })).not.toBeNull();
    expect(staffSessionOrNull(session("student", true), { verified: false })).toBeNull();
    expect(staffSessionOrNull(session("admin", true, "suspended"), { verified: true })).toBeNull();
    expect(staffSessionOrNull(null, { verified: false })).toBeNull();
  });
});
