import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, newTotpSecret, otpauthUri, totpAt, verifyTotp } from "./totp";

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890" (8-digit codes; 6 digits = last 6).
const RFC_SEED = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("totpAt", () => {
  it("matches the RFC 6238 SHA-1 vectors (8 digits)", () => {
    for (const [time, code] of RFC_VECTORS) {
      expect(totpAt(RFC_SEED, time, 8), String(time)).toBe(code);
    }
  });

  it("gives the last 6 digits by default", () => {
    expect(totpAt(RFC_SEED, 59)).toBe("287082");
  });
});

describe("base32", () => {
  it("round-trips and ignores case, spaces and padding", () => {
    const bytes = Buffer.from("hello totp secret!!!", "ascii");
    const encoded = base32Encode(bytes);
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(encoded.toLowerCase().replace(/(.{4})/g, "$1 "))).toEqual(bytes);
    expect(base32Decode("GEZDGNBV")).toEqual(Buffer.from("12345"));
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("ABC1")).toThrow();
  });
});

describe("verifyTotp", () => {
  const secret = RFC_SEED;
  const now = 1_111_111_111;
  const step = Math.floor(now / 30);

  it("accepts the current and adjacent steps, returning the matched step", () => {
    expect(verifyTotp(secret, totpAt(secret, now), now, null)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, now - 30), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, now + 30), now, null)).toBe(step + 1);
  });

  it("refuses codes outside the window, malformed codes and replays", () => {
    expect(verifyTotp(secret, totpAt(secret, now - 90), now, null)).toBeNull();
    expect(verifyTotp(secret, "12345", now, null)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now, null)).toBeNull();
    // Already used this step (or a later one): replay.
    expect(verifyTotp(secret, totpAt(secret, now), now, step)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now - 30), now, step)).toBeNull();
  });

  it("accepts a code with spaces", () => {
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, null)).toBe(step);
  });
});

describe("secrets and URIs", () => {
  it("makes a 20-byte secret, base32", () => {
    const secret = newTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it("builds an otpauth URI with issuer and label", () => {
    const uri = otpauthUri("GEZDGNBV", "teacher@example.com");
    expect(uri).toBe(
      "otpauth://totp/Al-Namer:teacher%40example.com?secret=GEZDGNBV&issuer=Al-Namer&algorithm=SHA1&digits=6&period=30",
    );
  });
});
