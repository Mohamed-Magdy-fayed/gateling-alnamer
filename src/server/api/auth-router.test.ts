import { beforeEach, describe, expect, it, vi } from "vitest";
import { CODE_RESEND_COOLDOWN_MS } from "@/server/config/policy";

const h = vi.hoisted(() => ({
  pending: null as null | { email: string; issuedAt: number },
  user: undefined as undefined | { id: string },
  row: null as null | { emailStatus: "queued" | "sent" | "failed"; createdAt: Date },
  asked: [] as string[],
}));

vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/server/auth/pending-reset", () => ({ readPendingReset: async () => h.pending }));
vi.mock("@/server/auth/code-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/code-status")>()),
  latestCodeRow: async (userId: string, purpose: string) => {
    h.asked.push(`${userId}:${purpose}`);
    return h.row;
  },
}));
vi.mock("@/server/db", () => ({
  db: () => ({ query: { users: { findFirst: async () => h.user } } }),
}));

import { appRouter } from "./root";
import { createCallerFactory } from "./trpc";

const caller = (user: { id: string } | null) =>
  createCallerFactory(appRouter)({ user: user as never });

beforeEach(() => {
  h.pending = null;
  h.user = undefined;
  h.row = null;
  h.asked.length = 0;
});

describe("auth.codeStatus", () => {
  it("rejects an anonymous caller for email verification", async () => {
    await expect(caller(null).auth.codeStatus({ purpose: "email_verify" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("reads the signed-in user's own verification code", async () => {
    h.row = { emailStatus: "failed", createdAt: new Date() };
    const result = await caller({ id: "u1" }).auth.codeStatus({ purpose: "email_verify" });
    expect(result.status).toBe("failed");
    expect(h.asked).toEqual(["u1:email_verify"]);
  });

  it("answers a reset for an unknown email exactly like a delivered one, from the cookie only", async () => {
    const issuedAt = Date.now() - 5_000;
    h.pending = { email: "ghost@example.test", issuedAt };
    h.user = undefined;
    const unknown = await caller(null).auth.codeStatus({ purpose: "password_reset" });
    h.user = { id: "u2" };
    h.row = { emailStatus: "sent", createdAt: new Date(issuedAt) };
    const known = await caller(null).auth.codeStatus({ purpose: "password_reset" });
    expect(unknown).toEqual(known);
    expect(unknown).toEqual({ status: "sent", canResendAt: issuedAt + CODE_RESEND_COOLDOWN_MS });
    expect(JSON.stringify(unknown)).not.toContain("ghost");
  });

  it("has nothing to report for a reset without the pending cookie", async () => {
    expect(await caller(null).auth.codeStatus({ purpose: "password_reset" })).toEqual({
      status: "sent",
      canResendAt: 0,
    });
    expect(h.asked).toEqual([]);
  });
});
