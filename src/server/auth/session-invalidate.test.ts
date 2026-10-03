import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deleteUserSessions: vi.fn(async (..._args: unknown[]) => ["a", "b"]),
  cacheDeleteUser: vi.fn(async (..._args: unknown[]) => {}),
}));
vi.mock("./session-repo", () => ({ deleteUserSessions: h.deleteUserSessions }));
vi.mock("./session-cache", () => ({ cacheDeleteUser: h.cacheDeleteUser }));

const { invalidateUserSessionsCore, deleteUserSessionsIn } = await import("./session-invalidate");

beforeEach(() => {
  h.deleteUserSessions.mockClear();
  h.cacheDeleteUser.mockClear();
});

describe("invalidateUserSessionsCore", () => {
  it("deletes the rows then purges the cache for those hashes", async () => {
    await invalidateUserSessionsCore("u1");
    expect(h.deleteUserSessions).toHaveBeenCalledWith("u1", undefined);
    expect(h.cacheDeleteUser).toHaveBeenCalledWith("u1", ["a", "b"], undefined);
  });

  it("with a tx the rows go through it, and the cache purge is left to the caller", async () => {
    const tx = { marker: "tx" };
    const deleted = await deleteUserSessionsIn(tx as never, "u1");
    expect(h.deleteUserSessions).toHaveBeenCalledWith("u1", undefined, tx);
    expect(deleted).toEqual(["a", "b"]);
    expect(h.cacheDeleteUser).not.toHaveBeenCalled();
  });
});
