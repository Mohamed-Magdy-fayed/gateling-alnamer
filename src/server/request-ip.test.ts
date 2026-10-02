import { describe, expect, it } from "vitest";
import { clientIp } from "./request-ip";

const h = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("clientIp", () => {
  const spoofed = h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "x-real-ip": "9.9.9.9" });

  it("uses the first x-forwarded-for entry only on Vercel", () => {
    expect(clientIp(spoofed, { VERCEL: "1" })).toBe("1.2.3.4");
  });

  it("ignores x-real-ip on Vercel unless the proxy is trusted", () => {
    expect(clientIp(h({ "x-real-ip": "9.9.9.9" }), { VERCEL: "1" })).toBe("local");
  });

  it("reads x-real-ip only when TRUST_PROXY_HEADERS=1", () => {
    expect(clientIp(spoofed, { TRUST_PROXY_HEADERS: "1" })).toBe("9.9.9.9");
    expect(clientIp(spoofed, { TRUST_PROXY_HEADERS: "0" })).toBe("local");
  });

  it("trusts no header by default: a client-set value never picks its own bucket", () => {
    expect(clientIp(spoofed, {})).toBe("local");
    expect(clientIp(h({ "x-real-ip": "9.9.9.9" }), {})).toBe("local");
  });

  it("falls back to local", () => {
    expect(clientIp(h({}), {})).toBe("local");
    expect(clientIp(h({}), { VERCEL: "1" })).toBe("local");
    expect(clientIp(h({}), { TRUST_PROXY_HEADERS: "1" })).toBe("local");
  });
});
