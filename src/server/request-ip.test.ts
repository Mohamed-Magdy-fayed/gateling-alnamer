import { describe, expect, it } from "vitest";
import { clientIp } from "./request-ip";

const h = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry only on Vercel", () => {
    const headers = h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "x-real-ip": "9.9.9.9" });
    expect(clientIp(headers, { VERCEL: "1" })).toBe("1.2.3.4");
  });

  it("ignores x-forwarded-for off Vercel and reads x-real-ip", () => {
    const headers = h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" });
    expect(clientIp(headers, {})).toBe("9.9.9.9");
  });

  it("falls back to local", () => {
    expect(clientIp(h({}), {})).toBe("local");
    expect(clientIp(h({}), { VERCEL: "1" })).toBe("local");
  });
});
