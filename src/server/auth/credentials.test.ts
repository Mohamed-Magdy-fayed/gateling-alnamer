import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: () => ({}) }));
vi.mock("./password", async (importOriginal) => {
  const original = await importOriginal<typeof import("./password")>();
  return { ...original, verifyDummy: vi.fn(original.verifyDummy) };
});

const { authenticate } = await import("./credentials");
const { verifyDummy, hashPassword } = await import("./password");

function connWith(
  credential: { passwordHash: string; passwordSalt: string | null },
  isSample = false,
) {
  return {
    query: {
      users: {
        findFirst: async () => ({ id: "u1", status: "active", isSample, credentials: credential }),
      },
    },
  } as unknown as Parameters<typeof authenticate>[2];
}

beforeEach(() => vi.mocked(verifyDummy).mockClear());

describe("sample accounts", () => {
  const RIGHT = "right pass 1";

  it("cannot sign in when APP_MODE=live: the normal failure, after one dummy verify", async () => {
    const conn = connWith({ passwordHash: await hashPassword(RIGHT), passwordSalt: null }, true);
    vi.mocked(verifyDummy).mockClear();
    await expect(authenticate("demo@example.test", RIGHT, conn, "live")).resolves.toBeNull();
    expect(verifyDummy).toHaveBeenCalledTimes(1);
  });

  it("still signs in when APP_MODE=demo", async () => {
    const conn = connWith({ passwordHash: await hashPassword(RIGHT), passwordSalt: null }, true);
    await expect(authenticate("demo@example.test", RIGHT, conn, "demo")).resolves.toBe("u1");
  });

  it("does not affect a real account in live", async () => {
    const conn = connWith({ passwordHash: await hashPassword(RIGHT), passwordSalt: null }, false);
    await expect(authenticate("real@example.test", RIGHT, conn, "live")).resolves.toBe("u1");
  });
});

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
