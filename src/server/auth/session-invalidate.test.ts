import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deleteUserSessions: vi.fn(async (..._args: unknown[]) => ["a", "b"]),
  cacheDeleteUser: vi.fn(async (..._args: unknown[]) => {}),
  preDeletes: 0,
}));
vi.mock("@/server/db", () => ({
  db: () => ({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        marker: "tx",
        delete: () => ({
          where: async () => {
            h.preDeletes += 1;
          },
        }),
      }),
  }),
}));
vi.mock("./session-repo", () => ({ deleteUserSessions: h.deleteUserSessions }));
vi.mock("./session-cache", () => ({ cacheDeleteUser: h.cacheDeleteUser }));

const { invalidateUserSessionsCore, deleteUserSessionsIn } = await import("./session-invalidate");

beforeEach(() => {
  h.deleteUserSessions.mockClear();
  h.cacheDeleteUser.mockClear();
  h.preDeletes = 0;
});

describe("invalidateUserSessionsCore", () => {
  it("deletes the rows and pre-sessions in one tx, then purges the cache for those hashes", async () => {
    await invalidateUserSessionsCore("u1", { exceptTokenHash: "keep" });
    expect(h.deleteUserSessions).toHaveBeenCalledWith(
      "u1",
      "keep",
      expect.objectContaining({ marker: "tx" }),
    );
    // A8 L1: "sign out other sessions" also ends pre-sessions.
    expect(h.preDeletes).toBe(1);
    expect(h.cacheDeleteUser).toHaveBeenCalledWith("u1", ["a", "b"], "keep");
  });

  it("with a tx the rows go through it, and the cache purge is left to the caller", async () => {
    const tx = { marker: "tx", delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })) };
    const deleted = await deleteUserSessionsIn(tx as never, "u1");
    expect(h.deleteUserSessions).toHaveBeenCalledWith("u1", undefined, tx);
    expect(deleted).toEqual(["a", "b"]);
    expect(h.cacheDeleteUser).not.toHaveBeenCalled();
  });

  it("also deletes the user's pre-sessions through the same tx", async () => {
    const where = vi.fn(async () => undefined);
    const tx = { delete: vi.fn(() => ({ where })) };
    await deleteUserSessionsIn(tx as never, "u1");
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
