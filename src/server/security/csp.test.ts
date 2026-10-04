import { describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, newNonce, sentryOrigin } from "./csp";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((part) => part.startsWith(`${name} `) || part === name);

describe("buildCsp", () => {
  const base = { nonce: "abc", development: false, https: false };

  it("locks scripts to the nonce (strict-dynamic) plus Turnstile, and denies framing", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "script-src")).toBe(
      "script-src 'self' 'nonce-abc' 'strict-dynamic' https://challenges.cloudflare.com",
    );
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "frame-src")).toBe("frame-src 'self' https://challenges.cloudflare.com");
    expect(directive(csp, "report-uri")).toBe("report-uri /api/csp-report");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("development adds eval and websockets; https adds upgrades", () => {
    const dev = buildCsp({ ...base, development: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toBe("connect-src 'self' ws:");
    expect(directive(buildCsp({ ...base, https: true }), "upgrade-insecure-requests")).toBe(
      "upgrade-insecure-requests",
    );
  });

  it("allows the Sentry ingest origin only for a valid https DSN", () => {
    const dsn = "https://key@o1.ingest.sentry.io/42";
    expect(directive(buildCsp({ ...base, sentryDsn: dsn }), "connect-src")).toBe(
      "connect-src 'self' https://o1.ingest.sentry.io",
    );
    expect(sentryOrigin("http://key@evil.test/1")).toBeNull();
    expect(sentryOrigin("not a url")).toBeNull();
    expect(sentryOrigin(undefined)).toBeNull();
  });
});

describe("newNonce and the header name", () => {
  it("makes distinct 16-byte base64 nonces", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(newNonce());
  });

  it("is report-only until enforced", () => {
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeaderName(true)).toBe("Content-Security-Policy");
  });
});
