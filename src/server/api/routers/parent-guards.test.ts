import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({
  listChildrenForParent: vi.fn(async () => []),
  createChild: vi.fn(async () => ({ ok: true, childId: "c" })),
  issueInvite: vi.fn(async () => ({
    ok: true,
    code: "ABCD-EFGH",
    expiresAt: new Date(),
  })),
  resetChildPassword: vi.fn(async () => ({ ok: true, mode: "direct" })),
  unlinkParent: vi.fn(async () => ({ ok: true })),
  redeemInvite: vi.fn(async () => ({ ok: true, parentId: "p" })),
  listActiveInvites: vi.fn(async () => []),
  listParentsForStudent: vi.fn(async () => []),
}));
vi.mock("@/server/parents/service", () => svc);
vi.mock("@/server/parents/views", () => svc);
vi.mock("@/server/auth/session", () => ({
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("@/server/auth/request-context", () => ({
  requestContext: vi.fn(async () => ({ ip: "1.2.3.4", deviceId: null })),
}));
vi.mock("@/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example" }),
}));

import { appRouter } from "../root";
import { createCallerFactory, type TrpcContext } from "../trpc";

const HEADERS = new Headers({
  origin: "https://alnamer.example",
  host: "alnamer.example",
});
const ID = "7b0f6c5e-3b1a-4c53-9a3a-1d2e3f4a5b6c";
type Role = "student" | "parent" | "admin";
const user = (role: Role): NonNullable<TrpcContext["user"]> => ({
  id: ID,
  name: role,
  email: `${role}@example.test`,
  role,
  status: "active",
});
const as = (u: TrpcContext["user"], headers: Headers | null = HEADERS) =>
  createCallerFactory(appRouter)({ user: u, headers: headers ?? undefined });

type Call = (c: ReturnType<typeof as>) => Promise<unknown>;
const parentCalls: Record<string, Call> = {
  "children.list": (c) => c.parent.children.list(),
  "children.create": (c) =>
    c.parent.children.create({
      name: "Sara",
      username: "sara_1",
      password: "longenough1",
      dateOfBirth: "2015-01-01",
    }),
  "children.resetPassword": (c) => c.parent.children.resetPassword({ childId: ID }),
  "children.unlink": (c) => c.parent.children.unlink({ childId: ID }),
  "invites.create": (c) => c.parent.invites.create(),
  "invites.list": (c) => c.parent.invites.list(),
};
const studentCalls: Record<string, Call> = {
  redeem: (c) => c.student.parentLinks.redeem({ code: "ABCD-EFGH" }),
  list: (c) => c.student.parentLinks.list(),
  unlink: (c) => c.student.parentLinks.unlink({ parentId: ID }),
};

beforeEach(() => vi.clearAllMocks());

describe("parent.* guards", () => {
  for (const [name, call] of Object.entries(parentCalls)) {
    it(`${name}: anonymous is UNAUTHORIZED, student and admin are FORBIDDEN`, async () => {
      await expect(call(as(null))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(call(as(user("student")))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(call(as(user("admin")))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();
    });
    it(`${name}: a parent passes the guard`, async () => {
      await expect(call(as(user("parent")))).resolves.toBeDefined();
    });
  }

  it("parent mutations need a same-site Origin", async () => {
    await expect(parentCalls["invites.create"]?.(as(user("parent"), null))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects malformed input with BAD_REQUEST before the service runs", async () => {
    await expect(
      as(user("parent")).parent.children.unlink({ childId: "nope" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(svc.unlinkParent).not.toHaveBeenCalled();
  });
});

describe("student.parentLinks.* guards", () => {
  for (const [name, call] of Object.entries(studentCalls)) {
    it(`${name}: anonymous is UNAUTHORIZED, parent and admin are FORBIDDEN`, async () => {
      await expect(call(as(null))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(call(as(user("parent")))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(call(as(user("admin")))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();
    });
    it(`${name}: a student passes the guard`, async () => {
      await expect(call(as(user("student")))).resolves.toBeDefined();
    });
  }

  it("redeem passes the request IP to the service", async () => {
    await as(user("student")).student.parentLinks.redeem({ code: "ABCD-EFGH" });
    expect(svc.redeemInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: ID,
        code: "ABCD-EFGH",
        ip: "1.2.3.4",
      }),
    );
  });
});
