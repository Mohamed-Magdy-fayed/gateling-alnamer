import { describe, expect, it } from "vitest";
import { isAcceptablePassword } from "./auth/password-policy";
import { isLocalHostname } from "./local-hosts";

describe("isLocalHostname", () => {
  it("knows the three local hostnames and nothing else", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"])
      expect(isLocalHostname(host)).toBe(true);
    for (const host of ["alnamer.gateling.com", "localhost.evil.test", "0.0.0.0"]) {
      expect(isLocalHostname(host)).toBe(false);
    }
  });
});

describe("isAcceptablePassword", () => {
  it("accepts 8 to 128 characters", () => {
    expect(isAcceptablePassword("x".repeat(7))).toBe(false);
    expect(isAcceptablePassword("x".repeat(8))).toBe(true);
    expect(isAcceptablePassword("x".repeat(128))).toBe(true);
    expect(isAcceptablePassword("x".repeat(129))).toBe(false);
  });
});
