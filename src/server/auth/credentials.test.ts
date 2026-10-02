import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: () => ({}) }));
vi.mock("./password", async (importOriginal) => {
  const original = await importOriginal<typeof import("./password")>();
  return { ...original, verifyDummy: vi.fn(original.verifyDummy) };
});

const { authenticate } = await import("./credentials");
const { verifyDummy } = await import("./password");

function connWith(credential: { passwordHash: string; passwordSalt: string | null }) {
  return {
    query: {
      users: { findFirst: async () => ({ id: "u1", status: "active", credentials: credential }) },
    },
  } as unknown as Parameters<typeof authenticate>[2];
}

beforeEach(() => vi.mocked(verifyDummy).mockClear());

describe("authenticate timing parity", () => {
  it("still runs the dummy verify for a legacy credential that has no salt", async () => {
    const conn = connWith({ passwordHash: "ab".repeat(64), passwordSalt: null });
    await expect(authenticate("someone@example.test", "any password 1", conn)).resolves.toBeNull();
    expect(verifyDummy).toHaveBeenCalledTimes(1);
  });

  it("runs the dummy verify for an unknown user", async () => {
    const conn = {
      query: { users: { findFirst: async () => undefined } },
    } as unknown as Parameters<typeof authenticate>[2];
    await expect(authenticate("nobody@example.test", "any password 1", conn)).resolves.toBeNull();
    expect(verifyDummy).toHaveBeenCalledTimes(1);
  });
});
