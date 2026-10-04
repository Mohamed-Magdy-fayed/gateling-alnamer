import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const call = (path: string) => proxy(new NextRequest(`http://localhost:3400${path}`));

describe("proxy ?lang=", () => {
  it("sets the locale cookie and redirects without the param", () => {
    const res = call("/courses?lang=en&subject=math");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3400/courses?subject=math");
    const cookie = res.cookies.get("locale");
    expect(cookie?.value).toBe("en");
    expect(cookie?.path).toBe("/");
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 365);
  });

  it("accepts ar too", () => {
    const res = call("/?lang=ar");
    expect(res.status).toBe(307);
    expect(res.cookies.get("locale")?.value).toBe("ar");
  });

  it("passes other values and requests without lang through untouched", () => {
    for (const path of ["/?lang=fr", "/?lang=", "/courses"]) {
      const res = call(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
      expect(res.cookies.get("locale"), path).toBeUndefined();
    }
  });

  it("matcher excludes _next, api and static files", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/courses")).toBe(true);
    expect(re.test("/")).toBe(true);
    expect(re.test("/_next/static/x.js")).toBe(false);
    expect(re.test("/api/trpc/x")).toBe(false);
    expect(re.test("/favicon.ico")).toBe(false);
  });

  it("matcher anchors its exclusions to whole segments", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/courses/node.js")).toBe(true);
    expect(re.test("/apiary")).toBe(true);
    expect(re.test("/api")).toBe(false);
    expect(re.test("/api/x")).toBe(false);
    expect(re.test("/_nextjs-guide")).toBe(true);
    expect(re.test("/robots.txt")).toBe(false);
  });
});

describe("proxy CSP (F5b)", () => {
  const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']+)'/)?.[1];

  it("sends a report-only CSP with a fresh nonce and hands the same nonce to the render", () => {
    const first = call("/courses");
    const csp = first.headers.get("content-security-policy-report-only");
    const nonce = nonceOf(csp);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(nonceOf(first.headers.get("x-middleware-request-content-security-policy"))).toBe(nonce);
    // Not enforced yet: no enforcing header.
    expect(first.headers.get("content-security-policy")).toBeNull();
    const second = call("/courses").headers.get("content-security-policy-report-only");
    expect(nonceOf(second)).not.toBe(nonce);
  });

  it("asks for upgrades only on https", () => {
    const http = call("/").headers.get("content-security-policy-report-only");
    expect(http).not.toContain("upgrade-insecure-requests");
    const https = proxy(new NextRequest("https://alnamer.example/")).headers.get(
      "content-security-policy-report-only",
    );
    expect(https).toContain("upgrade-insecure-requests");
  });
});
