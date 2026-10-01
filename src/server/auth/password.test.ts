import { describe, expect, it } from "vitest";
import {
  generateSalt,
  hashPassword,
  randomCode,
  randomToken,
  sha256,
  verifyPassword,
} from "./password";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const salt = generateSalt();
    const hash = await hashPassword("correct horse", salt);
    expect(await verifyPassword("correct horse", salt, hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const salt = generateSalt();
    const hash = await hashPassword("correct horse", salt);
    expect(await verifyPassword("wrong horse", salt, hash)).toBe(false);
  });

  it("rejects a stored hash of a different length", async () => {
    const salt = generateSalt();
    const hash = await hashPassword("correct horse", salt);
    expect(await verifyPassword("correct horse", salt, hash.slice(0, 32))).toBe(false);
  });

  it("normalises passwords to NFKC before hashing", async () => {
    const salt = generateSalt();
    expect(await hashPassword("ﬁ", salt)).toBe(await hashPassword("fi", salt));
  });

  it("produces different hashes for different salts", async () => {
    expect(await hashPassword("pw", "a")).not.toBe(await hashPassword("pw", "b"));
  });

  it("generates a 32-character hex salt", () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("sha256", () => {
  it("matches the known vector for 'abc'", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("randomCode", () => {
  it("returns six digits by default, zero padded", () => {
    for (let i = 0; i < 200; i++) expect(randomCode()).toMatch(/^\d{6}$/);
  });

  it("honours a custom length", () => {
    expect(randomCode(4)).toMatch(/^\d{4}$/);
  });
});

describe("randomToken", () => {
  it("returns base64url text of the requested size", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(Buffer.from(randomToken(8), "base64url")).toHaveLength(8);
  });

  it("is different on every call", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});
