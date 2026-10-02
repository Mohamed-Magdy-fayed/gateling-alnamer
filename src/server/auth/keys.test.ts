import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { authKey, deriveKey, keyedHash, resolveAuthSecret } from "./keys";

const SECRET = "s".repeat(40);

describe("deriveKey", () => {
  it("is HMAC-SHA256(AUTH_SECRET, purpose)", () => {
    const expected = createHmac("sha256", SECRET).update("codes").digest();
    expect(deriveKey(SECRET, "codes").equals(expected)).toBe(true);
  });

  it("gives every purpose its own key and every secret its own keys", () => {
    const purposes = ["codes", "rl", "rp", "did"] as const;
    const keys = purposes.map((purpose) => deriveKey(SECRET, purpose).toString("hex"));
    expect(new Set(keys).size).toBe(purposes.length);
    expect(deriveKey("x".repeat(40), "rl").equals(deriveKey(SECRET, "rl"))).toBe(false);
  });
});

describe("keyedHash", () => {
  it("is HMAC-SHA256 under the key, hex, and differs from a bare sha256", () => {
    const key = deriveKey(SECRET, "rl");
    expect(keyedHash(key, "a@b.test")).toBe(
      createHmac("sha256", key).update("a@b.test").digest("hex"),
    );
    expect(keyedHash(key, "a@b.test")).not.toBe(keyedHash(deriveKey(SECRET, "codes"), "a@b.test"));
  });
});

describe("resolveAuthSecret", () => {
  it("uses the configured secret", () => {
    expect(resolveAuthSecret({ AUTH_SECRET: SECRET })).toBe(SECRET);
    expect(authKey("did", { AUTH_SECRET: SECRET }).equals(deriveKey(SECRET, "did"))).toBe(true);
  });

  it("falls back to one per-process random secret and warns once without printing it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = resolveAuthSecret({});
    const b = resolveAuthSecret({ AUTH_SECRET: "too short" });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.join(" ")).toContain("AUTH_SECRET");
    expect(warn.mock.calls[0]?.join(" ")).not.toContain(a);
    warn.mockRestore();
  });
});
