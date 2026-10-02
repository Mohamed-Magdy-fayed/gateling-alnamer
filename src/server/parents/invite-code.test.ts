import { describe, expect, it } from "vitest";
import { deriveKey, keyedHash } from "@/server/auth/keys";
import {
  formatInviteCode,
  generateInviteCode,
  hashInviteCode,
  INVITE_ALPHABET,
  normalizeInviteCode,
} from "./invite-code";

describe("invite codes", () => {
  it("generates 8 characters from the alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateInviteCode();
      expect(code).toMatch(new RegExp(`^[${INVITE_ALPHABET}]{8}$`));
    }
  });

  it("uses a 30-symbol alphabet without look-alikes", () => {
    expect(INVITE_ALPHABET).toHaveLength(30);
    expect(INVITE_ALPHABET).not.toMatch(/[01OILU]/);
  });

  it("formats as XXXX-XXXX and normalises dashes, spaces and case", () => {
    expect(formatInviteCode("ABCD2345")).toBe("ABCD-2345");
    expect(normalizeInviteCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(normalizeInviteCode("ab cd 23-45")).toBe("ABCD2345");
  });

  it("hashes the normalised code with an HMAC under the invite sub-key, not a bare sha256", () => {
    const secret = process.env.AUTH_SECRET ?? "";
    const expected = keyedHash(deriveKey(secret, "invite"), "ABCD2345");
    expect(hashInviteCode("abcd-2345")).toBe(expected);
    expect(hashInviteCode("ABCD2345")).toBe(expected);
    expect(expected).not.toBe(keyedHash(deriveKey(secret, "codes"), "ABCD2345"));
  });
});
