import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/server/auth/session", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { requirePageRole, requirePageUser } from "./page-guard";

const user = (role: string) => ({
  id: "u1",
  name: "n",
  email: "e@example.test",
  role,
  status: "active",
});

beforeEach(() => getCurrentUser.mockReset());

describe("requirePageUser", () => {
  it("returns the signed-in user", async () => {
    getCurrentUser.mockResolvedValue(user("student"));
    await expect(requirePageUser()).resolves.toMatchObject({ id: "u1" });
  });

  it("redirects anonymous visitors to sign-in with the encoded page they wanted", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(requirePageUser("/dashboard/learn/abc")).rejects.toThrow(
      "REDIRECT:/sign-in?next=%2Fdashboard%2Flearn%2Fabc",
    );
  });

  it("falls back to the dashboard for an unsafe next path", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(requirePageUser("//evil.example")).rejects.toThrow(
      "REDIRECT:/sign-in?next=%2Fdashboard",
    );
    await expect(requirePageUser("https://evil.example")).rejects.toThrow(
      "REDIRECT:/sign-in?next=%2Fdashboard",
    );
  });
});

describe("requirePageRole", () => {
  it("passes a user whose role is listed", async () => {
    getCurrentUser.mockResolvedValue(user("student"));
    await expect(requirePageRole("student")).resolves.toMatchObject({ role: "student" });
  });

  it("sends another role to the dashboard", async () => {
    getCurrentUser.mockResolvedValue(user("parent"));
    await expect(requirePageRole("student")).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("sends anonymous visitors to sign-in first", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(requirePageRole("student", "teacher")).rejects.toThrow(
      "REDIRECT:/sign-in?next=%2Fdashboard",
    );
  });
});

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

describe("every app page is guarded", () => {
  const root = path.resolve(import.meta.dirname, "../../app/(app)");
  const pages = pageFiles(root);

  it("finds the app pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(4);
  });

  it.each(pages.map((file) => [path.relative(root, file), file]))(
    "%s calls requirePageUser or requirePageRole",
    (relative, file) => {
      const source = readFileSync(file as string, "utf8");
      expect(
        /\brequirePage(User|Role)\(/.test(source),
        `src/app/(app)/${relative} has no page guard. Call requirePageUser() or requirePageRole(...) from "@/server/auth/page-guard".`,
      ).toBe(true);
    },
  );
});
