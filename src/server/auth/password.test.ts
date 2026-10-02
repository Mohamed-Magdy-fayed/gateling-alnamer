import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH } from "@/server/config/policy";
import {
  generateSalt,
  hashLegacyScrypt,
  hashPassword,
  isLegacyHash,
  randomCode,
  randomToken,
  sha256,
  verifyDummy,
  verifyPassword,
} from "./password";

const PHC_PREFIX = "$argon2id$v=19$m=19456,t=2,p=1$";

describe("password hashing", () => {
  it("hashes to an argon2id PHC string and verifies the round trip", async () => {
    const passwordHash = await hashPassword("correct horse");
    expect(passwordHash.startsWith(PHC_PREFIX)).toBe(true);
    expect(await verifyPassword("correct horse", { passwordHash, passwordSalt: null })).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const passwordHash = await hashPassword("correct horse");
    expect(await verifyPassword("wrong horse", { passwordHash, passwordSalt: null })).toBe(false);
  });

  it("uses a fresh salt for every hash", async () => {
    expect(await hashPassword("pw")).not.toBe(await hashPassword("pw"));
  });

  it("normalises passwords to NFKC before hashing", async () => {
    const passwordHash = await hashPassword("ﬁ");
    expect(await verifyPassword("fi", { passwordHash, passwordSalt: null })).toBe(true);
  });

  it("returns false for a malformed argon2 hash instead of throwing", async () => {
    const credential = { passwordHash: "$argon2id$garbage", passwordSalt: null };
    expect(await verifyPassword("pw", credential)).toBe(false);
  });

  it("verifies a legacy scrypt credential and flags it for rehash", async () => {
    const salt = generateSalt();
    const passwordHash = await hashLegacyScrypt("correct horse", salt);
    const credential = { passwordHash, passwordSalt: salt };
    expect(isLegacyHash(credential)).toBe(true);
    expect(await verifyPassword("correct horse", credential)).toBe(true);
    expect(await verifyPassword("wrong horse", credential)).toBe(false);
    expect(isLegacyHash({ passwordHash: await hashPassword("x"), passwordSalt: null })).toBe(false);
  });

  it("rejects a legacy hash of a different length or with no salt", async () => {
    const salt = generateSalt();
    const passwordHash = await hashLegacyScrypt("correct horse", salt);
    const truncated = { passwordHash: passwordHash.slice(0, 32), passwordSalt: salt };
    expect(await verifyPassword("correct horse", truncated)).toBe(false);
    expect(await verifyPassword("correct horse", { passwordHash, passwordSalt: null })).toBe(false);
  });

  it("normalises legacy scrypt passwords to NFKC", async () => {
    expect(await hashLegacyScrypt("ﬁ", "a")).toBe(await hashLegacyScrypt("fi", "a"));
  });

  it("generates a 32-character hex salt", () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("dummy verification", () => {
  it("ships a valid argon2id dummy hash with the standard parameters", () => {
    expect(DUMMY_PASSWORD_HASH.startsWith(PHC_PREFIX)).toBe(true);
  });

  it("always resolves false after running one argon2 verify", async () => {
    expect(await verifyDummy("anything")).toBe(false);
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
