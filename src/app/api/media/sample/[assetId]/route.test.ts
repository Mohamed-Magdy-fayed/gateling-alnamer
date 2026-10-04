import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; role: string };
    deviceId: string | null;
    twoFactorVerified: boolean;
  },
  viewers: [] as unknown[],
}));

vi.mock("@/server/auth/session", () => ({ getCurrentSession: async () => h.session }));
vi.mock("@/server/video/serve-sample", () => ({
  isSignedForAsset: () => true,
  serveSample: async (input: { viewer: unknown }) => {
    h.viewers.push(input.viewer);
    return { body: null, status: 204, headers: new Headers() };
  },
}));

const { GET } = await import("./route");

const call = () =>
  GET(
    {
      nextUrl: new URL("http://localhost/api/media/sample/a1?sig=x"),
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ assetId: "a1" }) },
  );

beforeEach(() => {
  h.viewers.length = 0;
});

describe("GET /api/media/sample/[assetId]", () => {
  it("plays for nobody when a staff session has not passed two-factor (A8 L4)", async () => {
    h.session = { user: { id: "t1", role: "teacher" }, deviceId: null, twoFactorVerified: false };
    await call();
    h.session = { ...h.session, twoFactorVerified: true };
    await call();
    h.session = { user: { id: "s1", role: "student" }, deviceId: "d1", twoFactorVerified: false };
    await call();
    expect(h.viewers).toEqual([
      null,
      { userId: "t1", deviceId: null },
      { userId: "s1", deviceId: "d1" },
    ]);
  });
});
