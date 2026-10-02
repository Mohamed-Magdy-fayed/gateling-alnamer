import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectUsedPaths, findIssues, listLeaves } from "./i18n-check.mjs";

const PLURAL = { zero: "", one: "", two: "", few: "", many: "", other: "" };

describe("listLeaves", () => {
  it("lists nested string leaves, arrays as one leaf, plural objects as one leaf", () => {
    const leaves = listLeaves({ a: { b: "x", c: PLURAL }, d: ["x"], e: "y" });
    expect([...leaves].sort()).toEqual(["a.b", "a.c", "d", "e"]);
  });
});

describe("collectUsedPaths", () => {
  it("resolves t., aliases, relative bases and bracket access", () => {
    const src = [
      'type AuthText = Dictionary["auth"];',
      "export function F({ t }: { t: AuthText }) { return t.fields.email; }",
    ].join("\n");
    expect(collectUsedPaths(src).paths).toContain("auth.fields.email");
    const aliased =
      "const d = t.dashboard.teacher;\nconst x = d.earnings;\nconst y = t.legal[page];";
    const out = collectUsedPaths(aliased);
    expect(out.paths).toContain("dashboard.teacher.earnings");
    expect(out.dynamic).toContain("legal");
  });
});

describe("findIssues", () => {
  const base = { dynamicRoots: [], enLeaves: ["a.b", "a.c"], arLeaves: ["a.b", "a.c"] };

  it("passes when every leaf is used", () => {
    expect(findIssues({ ...base, usedPaths: ["a.b", "a.c"] })).toEqual([]);
  });

  it("reports an unused leaf with its path", () => {
    const issues = findIssues({ ...base, usedPaths: ["a.b"] });
    expect(issues).toEqual([{ kind: "unused", path: "a.c" }]);
  });

  it("reports a used path missing from ar", () => {
    const issues = findIssues({ ...base, usedPaths: ["a.b", "a.c", "a.zzz"] });
    expect(issues).toEqual([{ kind: "missing-in-ar", path: "a.zzz" }]);
  });

  it("reports leaf-set differences between en and ar", () => {
    const issues = findIssues({ ...base, enLeaves: ["a.b"], usedPaths: ["a.b", "a.c"] });
    expect(issues).toEqual([{ kind: "missing-in-en", path: "a.c" }]);
  });

  it("honours dynamic roots and ignores deeper-than-leaf accesses", () => {
    const issues = findIssues({
      ...base,
      dynamicRoots: ["a"],
      usedPaths: [],
    });
    expect(issues).toEqual([]);
    expect(findIssues({ ...base, usedPaths: ["a.b.length", "a.c"] })).toEqual([]);
  });

  it("flags a bracket access whose root is not allow-listed", () => {
    const issues = findIssues({ ...base, usedPaths: ["a.b", "a.c"], dynamicUsed: ["a"] });
    expect(issues).toEqual([{ kind: "dynamic-not-listed", path: "a" }]);
  });
});

describe("real dictionaries", () => {
  it("have no issues", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "i18n-check.mjs")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 60000,
      },
    );
    expect(result.stdout + result.stderr).toContain("i18n:check ok");
    expect(result.status).toBe(0);
  });
});
