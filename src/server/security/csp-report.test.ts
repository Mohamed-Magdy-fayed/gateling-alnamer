import { describe, expect, it } from "vitest";
import { summarizeCspReport } from "./csp-report";

describe("summarizeCspReport", () => {
  it("reads the legacy shape and keeps only origin and path, never a query", () => {
    expect(
      summarizeCspReport({
        "csp-report": {
          "document-uri": "https://alnamer.example/reset-password/continue?t=secret-token",
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/x.js?k=secret",
        },
      }),
    ).toEqual([
      {
        directive: "script-src-elem",
        blocked: "https://evil.example",
        page: "/reset-password/continue",
      },
    ]);
  });

  it("reads the Reporting API array, keeps keywords, and ignores other report types", () => {
    const violations = summarizeCspReport([
      {
        type: "csp-violation",
        body: {
          documentURL: "https://alnamer.example/sign-in",
          effectiveDirective: "script-src-elem",
          blockedURL: "inline",
        },
      },
      { type: "deprecation", body: { id: "x" } },
    ]);
    expect(violations).toEqual([
      { directive: "script-src-elem", blocked: "inline", page: "/sign-in" },
    ]);
  });

  it("ignores garbage, caps at 10 reports and strips newlines", () => {
    expect(summarizeCspReport("nope")).toEqual([]);
    expect(summarizeCspReport({ "csp-report": { "blocked-uri": "x" } })).toEqual([]);
    const many = Array.from({ length: 20 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "img-src\nfake", blockedURL: "data", documentURL: "bad" },
    }));
    const out = summarizeCspReport(many);
    expect(out).toHaveLength(10);
    expect(out[0]).toEqual({ directive: "img-src fake", blocked: "data", page: "unknown" });
    const forged = summarizeCspReport({
      "csp-report": { "effective-directive": "img-src\u001b[31m\u2028x\ty", "blocked-uri": "data" },
    });
    expect(forged[0]?.directive).toBe("img-src [31m x y");
  });
});
