import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  verifiedAt: null as Date | null,
}));

vi.mock("./session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("redirect:/sign-in");
    return h.user;
  },
}));
vi.mock("@/server/db", () => ({
  db: () => ({
    query: { users: { findFirst: async () => ({ emailVerifiedAt: h.verifiedAt }) } },
  }),
}));

const { requireVerifiedEmail } = await import("./verified-email");

beforeEach(() => {
  h.user = { id: "u1" };
  h.verifiedAt = null;
});

describe("requireVerifiedEmail", () => {
  it("returns the user once the email is verified", async () => {
    h.verifiedAt = new Date("2026-10-01T00:00:00Z");
    await expect(requireVerifiedEmail()).resolves.toEqual({ id: "u1" });
  });

  it("throws a forbidden AppError while the email is unverified", async () => {
    const error = await requireVerifiedEmail().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("forbidden");
  });

  it("propagates the sign-in redirect for anonymous visitors", async () => {
    await Promise.resolve();
    h.user = null;
    await expect(requireVerifiedEmail()).rejects.toThrow("redirect:/sign-in");
  });
});
