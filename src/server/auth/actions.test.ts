import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatTime } from "@/i18n/config";
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
  memory: null as null | { hits: Map<string, number[]> },
  ip: "203.0.113.5",
  deviceId: "dev-1" as string | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({ t: en, locale: "en" as const }),
}));
vi.mock("@/server/rate-limit", async () => {
  const { MemoryLimiter } = await import("../../../test/fake-limiter");
  h.memory = new MemoryLimiter();
  return { createRateLimiter: () => h.memory };
});
vi.mock("./request-context", () => ({
  requestContext: async () => ({ ip: h.ip, deviceId: h.deviceId }),
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

const { requestPasswordResetAction, resetPasswordAction, signInAction, signUpAction } =
  await import("./actions");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  h.calls.length = 0;
  h.user = undefined;
  h.sent.length = 0;
  h.memory?.hits.clear();
  h.ip = "203.0.113.5";
  h.deviceId = "dev-1";
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

describe("abuse guards in the actions", () => {
  const wrongSignIn = (identifier: string) =>
    signInAction({ status: "idle" }, form({ identifier, password: "wrong pass 1" }));

  async function sequence(identifier: string) {
    const out: Array<{ message?: string; retryAt?: number; offerReset?: boolean }> = [];
    for (let i = 0; i < 11; i++) {
      const { message, retryAt, offerReset } = await wrongSignIn(identifier);
      out.push({ message, retryAt, offerReset });
    }
    return out;
  }

  it("locks the (identifier, device) pair after 10 attempts and shows when it ends", async () => {
    const out = await sequence("nobody@example.test");
    expect(out.slice(0, 3).every((r) => r.message === en.auth.errors.credentials)).toBe(true);
    // Until the captcha widget lands (A2.3) a step-up is a block with the captchaFailed copy.
    expect(out.slice(3, 10).every((r) => r.message === en.auth.states.captchaFailed)).toBe(true);
    const locked = out[10];
    expect(locked?.retryAt).toBeGreaterThan(Date.now());
    expect(locked?.message).toBe(
      en.auth.states.lockout.replace("{time}", formatTime("en", new Date(locked?.retryAt ?? 0))),
    );
    expect(locked?.offerReset).toBe(true);
  });

  it("answers an unknown identifier exactly like a known one", async () => {
    h.user = undefined;
    const unknown = await sequence("nobody@example.test");
    h.memory?.hits.clear();
    h.user = {
      id: "u1",
      status: "active",
      credentials: { passwordHash: await hashPassword("right pass 1"), passwordSalt: null },
    };
    const known = await sequence("nobody@example.test");
    expect(known.map((r) => r.message)).toEqual(unknown.map((r) => r.message));
  });

  it("clears the pair's counter after a successful sign-in", async () => {
    await wrongSignIn("u@example.test");
    await wrongSignIn("u@example.test");
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
    const lockKeys = [...(h.memory?.hits.keys() ?? [])].filter((key) => key.startsWith("lock:"));
    expect(lockKeys).toEqual([]);
  });

  it("rate-limits sign-up after 5 submissions from one IP", async () => {
    const submit = () => signUpAction({ status: "idle" }, form({}));
    for (let i = 0; i < 5; i++) {
      expect((await submit()).message).toBe(en.auth.errors.invalid);
    }
    const blocked = await submit();
    expect(blocked).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect(blocked.retryAt).toBeGreaterThan(Date.now());
  });

  it("rate-limits code requests per email and answers known and unknown emails alike", async () => {
    const request = () =>
      requestPasswordResetAction({ status: "idle" }, form({ email: "who@example.test" }));
    h.user = undefined;
    for (let i = 0; i < 3; i++) await request();
    const unknown = await request();
    h.memory?.hits.clear();
    h.user = { id: "u1", name: "U", email: "who@example.test" };
    for (let i = 0; i < 3; i++) await request();
    const known = await request();
    expect(unknown).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect({ ...known, retryAt: 0 }).toEqual({ ...unknown, retryAt: 0 });
  });

  it("rate-limits code verification per email before touching the code", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    const verify = () =>
      resetPasswordAction(
        { status: "idle" },
        form({ email: "who@example.test", code: "123456", password: "a-new-pass-1" }),
      );
    for (let i = 0; i < 10; i++) await verify();
    const verifies = h.verify.mock.calls.length;
    const blocked = await verify();
    expect(blocked).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect(h.verify.mock.calls.length).toBe(verifies);
  });
});
