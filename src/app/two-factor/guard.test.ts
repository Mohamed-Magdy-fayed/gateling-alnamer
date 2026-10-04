import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | { user: { role: string }; twoFactorVerified: boolean },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentSession: async () => h.session }));

const { requireUnverifiedStaff } = await import("./guard");

beforeEach(() => {
  h.session = null;
});

describe("requireUnverifiedStaff", () => {
  it("sends a signed-out visitor to sign in, keeping a safe next", async () => {
    await expect(requireUnverifiedStaff("/teach")).rejects.toThrow(
      "redirect:/sign-in?next=%2Fteach",
    );
    await expect(requireUnverifiedStaff("https://evil.example")).rejects.toThrow(
      "redirect:/sign-in?next=%2Fdashboard",
    );
  });

  it("sends students, parents and verified staff on to where they were going", async () => {
    h.session = { user: { role: "student" }, twoFactorVerified: false };
    await expect(requireUnverifiedStaff("/courses")).rejects.toThrow("redirect:/courses");
    h.session = { user: { role: "admin" }, twoFactorVerified: true };
    await expect(requireUnverifiedStaff("/admin")).rejects.toThrow("redirect:/admin");
  });

  it("lets an unverified staff session through to the two-factor screen", async () => {
    h.session = { user: { role: "reviewer" }, twoFactorVerified: false };
    await expect(requireUnverifiedStaff("/teach")).resolves.toMatchObject({ next: "/teach" });
  });
});
