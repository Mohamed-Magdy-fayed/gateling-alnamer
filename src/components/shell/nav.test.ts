import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ar } from "@/i18n/ar";
import { en } from "@/i18n/en";
import { NAV, type NavItem } from "./nav";

const ROLES = ["student", "parent", "teacher", "admin", "reviewer"] as const;
const appRoot = path.resolve(import.meta.dirname, "../../app/(app)");

function pageFile(href: string): string {
  const segments = href.split("/").filter(Boolean);
  return path.join(appRoot, ...segments, "page.tsx");
}

function lookup(dictionary: unknown, keyPath: string): unknown {
  return keyPath
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      dictionary,
    );
}

const all = ROLES.flatMap((role) => NAV[role].map((item) => [role, item] as const));

describe("nav config", () => {
  it("has an entry for every role", () => {
    expect(Object.keys(NAV).sort()).toEqual([...ROLES].sort());
  });

  it.each(all.map(([role, item]) => [role, item.href, item]))(
    "%s: %s maps to an existing page",
    (_role, href, _item) => {
      expect(existsSync(pageFile(href as string)), `${href} has no page.tsx`).toBe(true);
    },
  );

  it.each(all.map(([role, item]) => [role, item.labelKey, item]))(
    "%s: %s resolves in both dictionaries",
    (_role, key, _item) => {
      expect(typeof lookup(en, key as string)).toBe("string");
      expect(typeof lookup(ar, key as string)).toBe("string");
    },
  );

  it("every role starts with the dashboard and offers the account page", () => {
    for (const role of ROLES) {
      const hrefs = NAV[role].map((item: NavItem) => item.href);
      expect(hrefs[0]).toBe("/dashboard");
      expect(hrefs).toContain("/dashboard/account");
    }
  });

  it("lists no role-specific page for another role", () => {
    const common = new Set(["/dashboard", "/dashboard/account"]);
    expect(NAV.student.map((i) => i.href)).toContain("/dashboard/link-parent");
    for (const role of ROLES) {
      if (role === "student") continue;
      const extra = NAV[role].map((i) => i.href).filter((href) => !common.has(href));
      expect(extra, `${role} lists a student-only page`).not.toContain("/dashboard/link-parent");
    }
  });

  it("holds no duplicate hrefs within a role", () => {
    for (const role of ROLES) {
      const hrefs = NAV[role].map((i) => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });
});
