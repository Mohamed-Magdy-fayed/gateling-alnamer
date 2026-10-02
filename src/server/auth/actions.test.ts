import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { hashPassword } from "./password";

const h = vi.hoisted(() => ({
  user: undefined as unknown,
  calls: [] as string[],
  sent: [] as unknown[],
  issue: vi.fn(async (_userId: string, _purpose: string) => ({ codeId: "c1", code: "123456" })),
  decoy: vi.fn(async (_purpose: string) => undefined),
  verify: vi.fn(async (_userId: string, _purpose: string, _code: string) => ({
    ok: false as const,
    reason: "invalid" as const,
  })),
  verifyDecoy: vi.fn(async (_purpose: string, _code: string) => undefined),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({ t: en, locale: "en" as const }),
}));
vi.mock("@/server/db", () => ({
  db: () => ({ query: { users: { findFirst: async () => h.user } } }),
}));
vi.mock("@/server/jobs/send", () => ({
  sendEvent: async (...args: unknown[]) => {
    h.sent.push(args);
  },
}));
vi.mock("./codes", () => ({
  issueCode: h.issue,
  issueCodeDecoy: h.decoy,
  verifyCode: h.verify,
  verifyCodeDecoy: h.verifyDecoy,
  markCodeEmailSent: async () => undefined,
  deleteCode: async () => undefined,
}));
vi.mock("./session", () => ({
  createSession: async (userId: string) => {
    h.calls.push(`create:${userId}`);
  },
  destroySession: async () => {
    h.calls.push("destroy");
  },
  invalidateUserSessions: async () => undefined,
}));

const { requestPasswordResetAction, resetPasswordAction, signInAction } = await import("./actions");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  h.calls.length = 0;
  h.user = undefined;
  h.sent.length = 0;
  vi.clearAllMocks();
});

describe("signInAction", () => {
  it("gives the same generic error for an unknown user and a wrong password", async () => {
    h.user = undefined;
    const unknown = await signInAction(
      { status: "idle" },
      form({ identifier: "nobody@example.test", password: "whatever pass 1" }),
    );

    h.user = {
      id: "u1",
      status: "active",
      credentials: { passwordHash: await hashPassword("right pass 1"), passwordSalt: null },
    };
    const wrong = await signInAction(
      { status: "idle" },
      form({ identifier: "nobody@example.test", password: "wrong pass 1" }),
    );

    expect(unknown).toEqual(wrong);
    expect(unknown).toMatchObject({ status: "error", message: en.auth.errors.credentials });
    expect(h.calls).toEqual([]);
  });

  it("destroys any existing session before creating the new one", async () => {
    h.user = {
      id: "u1",
      status: "active",
      credentials: { passwordHash: await hashPassword("right pass 1"), passwordSalt: null },
    };
    await expect(
      signInAction(
        { status: "idle" },
        form({ identifier: "u@example.test", password: "right pass 1" }),
      ),
    ).rejects.toThrow("redirect:/dashboard");
    expect(h.calls).toEqual(["destroy", "create:u1"]);
  });
});

describe("requestPasswordResetAction", () => {
  const request = () =>
    requestPasswordResetAction({ status: "idle" }, form({ email: "who@example.test" }));

  it("does the same code work for an unknown email and skips only the send", async () => {
    h.user = undefined;
    const unknown = await request();
    expect(h.decoy).toHaveBeenCalledWith("password_reset");
    expect(h.issue).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);

    h.user = { id: "u1", name: "U", email: "who@example.test" };
    const known = await request();
    expect(h.issue).toHaveBeenCalledWith("u1", "password_reset");
    expect(h.decoy).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(1);
    expect(unknown).toEqual(known);
  });
});

describe("resetPasswordAction", () => {
  const reset = () =>
    resetPasswordAction(
      { status: "idle" },
      form({ email: "who@example.test", code: "123456", password: "a-new-pass-1" }),
    );

  it("spends a decoy verify and answers with the code error for an unknown email", async () => {
    h.user = undefined;
    const result = await reset();
    expect(h.verifyDecoy).toHaveBeenCalledWith("password_reset", "123456");
    expect(h.verify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error", message: en.auth.errors.code });
  });

  it("verifies against verification_codes and rejects an invalid code", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    const result = await reset();
    expect(h.verify).toHaveBeenCalledWith("u1", "password_reset", "123456");
    expect(result).toMatchObject({ status: "error", message: en.auth.errors.code });
  });
});
