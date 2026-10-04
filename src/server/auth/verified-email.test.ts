import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ row: undefined as undefined | { emailVerifiedAt: Date | null } }));

vi.mock("@/server/db", () => ({
  db: () => ({ query: { users: { findFirst: async () => h.row } } }),
}));

const { isEmailVerified } = await import("./verified-email");

describe("isEmailVerified", () => {
  it("is true only for a stored verification time", async () => {
    h.row = { emailVerifiedAt: new Date("2026-10-01T00:00:00Z") };
    expect(await isEmailVerified("u1")).toBe(true);
    h.row = { emailVerifiedAt: null };
    expect(await isEmailVerified("u1")).toBe(false);
    h.row = undefined;
    expect(await isEmailVerified("u1")).toBe(false);
  });
});
