import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example" }),
}));

import {
  createCallerFactory,
  protectedProcedure,
  roleProcedure,
  router,
  setTwoFactorEnforcedForTests,
  staffProcedure,
  superAdminProcedure,
  type TrpcContext,
} from "./trpc";

const testRouter = router({
  prot: protectedProcedure.query(({ ctx }) => ctx.user.id),
  role: roleProcedure("parent").query(({ ctx }) => ctx.user.role),
  staff: staffProcedure("admin", "teacher").query(({ ctx }) => ctx.user.role),
  superAdmin: superAdminProcedure.query(({ ctx }) => ctx.user.id),
});

const HEADERS = new Headers({ origin: "https://alnamer.example", host: "alnamer.example" });
type U = NonNullable<TrpcContext["user"]>;
const user = (over: Partial<U> = {}): U => ({
  id: "u1",
  name: "n",
  email: "e@example.test",
  role: "student",
  status: "active",
  ...over,
});
const as = (ctx: Partial<TrpcContext>) =>
  createCallerFactory(testRouter)({ user: null, headers: HEADERS, ...ctx });

beforeEach(() => setTwoFactorEnforcedForTests(null));
afterEach(() => setTwoFactorEnforcedForTests(null));

describe("protectedProcedure", () => {
  it("anonymous is UNAUTHORIZED", async () => {
    await expect(as({}).prot()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("suspended is FORBIDDEN", async () => {
    await expect(as({ user: user({ status: "suspended" }) }).prot()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("active passes", async () => {
    await expect(as({ user: user() }).prot()).resolves.toBe("u1");
  });
});

describe("roleProcedure", () => {
  it("anonymous UNAUTHORIZED, wrong role FORBIDDEN, right role passes", async () => {
    await expect(as({}).role()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(as({ user: user() }).role()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as({ user: user({ role: "parent" }) }).role()).resolves.toBe("parent");
  });
  it("suspended right role is FORBIDDEN", async () => {
    await expect(
      as({ user: user({ role: "parent", status: "suspended" }) }).role(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("staffProcedure", () => {
  const admin = user({ role: "admin" });
  it("wrong role is FORBIDDEN, anonymous UNAUTHORIZED", async () => {
    await expect(as({}).staff()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(as({ user: user({ role: "reviewer" }) }).staff()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("passes without 2FA only when enforcement is switched off", async () => {
    setTwoFactorEnforcedForTests(() => false);
    await expect(as({ user: admin, twoFactorVerified: false }).staff()).resolves.toBe("admin");
  });
  it("without 2FA is FORBIDDEN when enforced, passes when verified", async () => {
    setTwoFactorEnforcedForTests(() => true);
    await expect(as({ user: admin, twoFactorVerified: false }).staff()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(as({ user: admin }).staff()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as({ user: admin, twoFactorVerified: true }).staff()).resolves.toBe("admin");
  });
});

describe("superAdminProcedure", () => {
  const admin = user({ role: "admin" });
  it("a plain admin is FORBIDDEN, a super admin passes", async () => {
    await expect(
      as({ user: admin, isSuperAdmin: false, twoFactorVerified: true }).superAdmin(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      as({ user: admin, isSuperAdmin: true, twoFactorVerified: true }).superAdmin(),
    ).resolves.toBe("u1");
  });
  it("a non-admin flagged super admin is FORBIDDEN", async () => {
    await expect(
      as({ user: user({ role: "teacher" }), isSuperAdmin: true }).superAdmin(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("needs 2FA when enforced", async () => {
    setTwoFactorEnforcedForTests(() => true);
    await expect(
      as({ user: admin, isSuperAdmin: true, twoFactorVerified: false }).superAdmin(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      as({ user: admin, isSuperAdmin: true, twoFactorVerified: true }).superAdmin(),
    ).resolves.toBe("u1");
  });
  it("anonymous is UNAUTHORIZED", async () => {
    await expect(as({}).superAdmin()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("two-factor for staff on every procedure (A4)", () => {
  it("an unverified staff session reaches no protected procedure; students are unaffected", async () => {
    setTwoFactorEnforcedForTests(() => true);
    for (const role of ["teacher", "admin", "reviewer"] as const) {
      await expect(
        as({ user: user({ role }), twoFactorVerified: false }).prot(),
        role,
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        as({ user: user({ role }), twoFactorVerified: true }).prot(),
        role,
      ).resolves.toBe("u1");
    }
    await expect(
      as({ user: user({ role: "student" }), twoFactorVerified: false }).prot(),
    ).resolves.toBe("u1");
  });
});
