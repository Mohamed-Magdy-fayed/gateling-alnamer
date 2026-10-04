import { describe, expect, it } from "vitest";
import { ibanKeyring, openIban, sealIban } from "./payout-crypto";

const key = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const IBAN = "AE070331234567890123456";
const ALICE = "0190a000-0000-7000-8000-00000000000a";
const BOB = "0190a000-0000-7000-8000-00000000000b";

describe("ibanKeyring", () => {
  it("reads the current key, its version and the previous key", () => {
    const ring = ibanKeyring({
      IBAN_ENCRYPTION_KEY: key(2),
      IBAN_KEY_VERSION: "2",
      IBAN_ENCRYPTION_KEY_PREVIOUS: key(1),
    });
    expect(ring.version).toBe(2);
    expect(ring.keys.get(2)).toEqual(Buffer.alloc(32, 2));
    expect(ring.keys.get(1)).toEqual(Buffer.alloc(32, 1));
  });

  it("defaults to version 1 and, without a key outside live, derives one from AUTH_SECRET", () => {
    const env = { APP_MODE: "demo", AUTH_SECRET: "s".repeat(40) };
    const a = ibanKeyring(env);
    expect(a.version).toBe(1);
    expect(a.keys.get(1)).toHaveLength(32);
    expect(ibanKeyring(env).keys.get(1)).toEqual(a.keys.get(1));
  });

  it("refuses to run live without a key", () => {
    expect(() => ibanKeyring({ APP_MODE: "live", AUTH_SECRET: "s".repeat(40) })).toThrow(
      /IBAN_ENCRYPTION_KEY/,
    );
  });
});

describe("sealIban / openIban", () => {
  const ring = ibanKeyring({ IBAN_ENCRYPTION_KEY: key(3) });

  it("round-trips for the same teacher and records the key version", () => {
    const sealed = sealIban(ring, ALICE, IBAN);
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.ciphertext).not.toContain(IBAN);
    expect(openIban(ring, ALICE, sealed)).toBe(IBAN);
  });

  it("will not open a ciphertext moved to another teacher", () => {
    expect(openIban(ring, BOB, sealIban(ring, ALICE, IBAN))).toBeNull();
  });

  it("opens values sealed under the previous key during a rotation", () => {
    const old = ibanKeyring({ IBAN_ENCRYPTION_KEY: key(3) });
    const sealed = sealIban(old, ALICE, IBAN);
    const rotating = ibanKeyring({
      IBAN_ENCRYPTION_KEY: key(4),
      IBAN_KEY_VERSION: "2",
      IBAN_ENCRYPTION_KEY_PREVIOUS: key(3),
    });
    expect(openIban(rotating, ALICE, sealed)).toBe(IBAN);
    expect(sealIban(rotating, ALICE, IBAN).keyVersion).toBe(2);
    const after = ibanKeyring({ IBAN_ENCRYPTION_KEY: key(4), IBAN_KEY_VERSION: "2" });
    expect(openIban(after, ALICE, sealed)).toBeNull();
  });
});
