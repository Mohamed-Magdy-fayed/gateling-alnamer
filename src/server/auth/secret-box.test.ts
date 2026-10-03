import { describe, expect, it } from "vitest";
import { open, seal } from "./secret-box";

const KEY = Buffer.alloc(32, 7);

describe("secret box", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = seal(KEY, "JBSWY3DPEHPK3PXP");
    const b = seal(KEY, "JBSWY3DPEHPK3PXP");
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(open(KEY, a)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("refuses a wrong key, a tampered part and malformed input", () => {
    const sealed = seal(KEY, "secret");
    expect(open(Buffer.alloc(32, 8), sealed)).toBeNull();
    const [version, iv, tag, body] = sealed.split(".");
    const flipped = `${body?.slice(0, -2)}${body?.endsWith("A") ? "BB" : "AA"}`;
    expect(open(KEY, [version, iv, tag, flipped].join("."))).toBeNull();
    expect(open(KEY, "v2.a.b.c")).toBeNull();
    expect(open(KEY, "garbage")).toBeNull();
  });
});
