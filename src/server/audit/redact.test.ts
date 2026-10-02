import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("masks emails", () => {
    expect(redact({ email: "alice@domain.com" })).toEqual({ email: "a***@d***.com" });
    expect(redact({ parentEmail: "bob@mail.example.org" })).toEqual({
      parentEmail: "b***@m***.org",
    });
  });

  it("reduces iban keys to the last 4 characters", () => {
    expect(redact({ iban: "AE070331234567890123456" })).toEqual({ iban: "3456" });
    expect(redact({ newIBAN: "1234567890" })).toEqual({ newIBAN: "7890" });
  });

  it("removes secret-like keys", () => {
    const out = redact({
      password: "x",
      clientSecret: "x",
      accessToken: "x",
      tokenHash: "x",
      ciphertext: "x",
      totpSecret: "x",
      otp: "1",
      verifyCode: "1",
      name: "kept",
    });
    expect(out).toEqual({ name: "kept" });
  });

  it("recurses into nested objects and arrays", () => {
    const out = redact({
      list: [{ email: "a@b.co", password: "p", n: 1 }, "plain", 3],
      deep: { deeper: { iban: "9999000011112222", ok: true } },
    });
    expect(out).toEqual({
      list: [{ email: "a***@b***.co", n: 1 }, "plain", 3],
      deep: { deeper: { iban: "2222", ok: true } },
    });
  });

  it("does not mutate the input", () => {
    const input = { email: "alice@domain.com", nested: [{ password: "p" }] };
    const snapshot = structuredClone(input);
    redact(input);
    expect(input).toEqual(snapshot);
  });

  it("passes through primitives and null", () => {
    expect(redact(null)).toBeNull();
    expect(redact("x")).toBe("x");
    expect(redact(5)).toBe(5);
  });
});
