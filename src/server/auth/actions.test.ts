import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { formatTime } from "@/i18n/config";
import { en } from "@/i18n/en";
import { hashPassword } from "./password";

const h = vi.hoisted(() => ({
  user: undefined as unknown,
  calls: [] as string[],
  sent: [] as unknown[],
  sendError: null as null | Error,
  issue: vi.fn(async (_userId: string, _purpose: string) => ({ codeId: "c1", code: "123456" })),
  decoy: vi.fn(async (_purpose: string) => undefined),
  verify: vi.fn(async (_userId: string, _purpose: string, _code: string) => ({
    ok: false as const,
    reason: "invalid" as const,
  })),
  verifyDecoy: vi.fn(async (_purpose: string, _code: string) => undefined),
  memory: null as null | { hits: Map<string, number[]> },
  signUp: null as null | Mock<typeof import("./sign-up").signUpUser>,
  ip: "203.0.113.5",
  deviceId: "dev-1" as string | null,
  sessionUser: null as null | { id: string; email: string | null },
  pending: null as null | { email: string; issuedAt: number },
  pendingSet: [] as string[],
  pendingCleared: 0,
  codeRow: null as null | { emailStatus: "queued" | "sent" | "failed"; createdAt: Date },
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
vi.mock("./captcha", () => ({
  // Same rule as the fake provider: any non-empty token passes except "fail".
  verifyCaptcha: async (token: string | undefined) => Boolean(token?.trim()) && token !== "fail",
}));
vi.mock("./sign-up", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sign-up")>();
  h.signUp = vi.fn(actual.signUpUser);
  return {
    ...actual,
    signUpUser: (...args: Parameters<typeof actual.signUpUser>) => {
      if (!h.signUp) throw new Error("signUp spy missing");
      return h.signUp(...args);
    },
  };
});
vi.mock("./request-context", () => ({
  requestContext: async () => ({ ip: h.ip, deviceId: h.deviceId }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("./pending-reset", () => ({
  setPendingReset: async (email: string) => {
    h.pendingSet.push(email);
  },
  readPendingReset: async () => h.pending,
  clearPendingReset: async () => {
    h.pendingCleared += 1;
  },
}));
vi.mock("./code-status", () => ({ latestCodeRow: async () => h.codeRow }));
vi.mock("@/server/db", () => ({
  db: () => ({
    query: { users: { findFirst: async () => h.user } },
    update: () => ({
      set: () => ({
        where: async () => {
          h.calls.push("verified");
        },
      }),
    }),
  }),
}));
vi.mock("@/server/jobs/send", () => ({
  sendEvent: async (...args: unknown[]) => {
    if (h.sendError) throw h.sendError;
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
  getCurrentUser: async () => h.sessionUser,
  createSession: async (userId: string) => {
    h.calls.push(`create:${userId}`);
  },
  destroySession: async () => {
    h.calls.push("destroy");
  },
  invalidateUserSessions: async () => undefined,
}));

const OK = { captcha_token: "fake-ok" };
const {
  requestPasswordResetAction,
  resendCodeAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  verifyEmailAction,
} = await import("./actions");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  h.calls.length = 0;
  h.user = undefined;
  h.sent.length = 0;
  h.sendError = null;
  h.memory?.hits.clear();
  h.ip = "203.0.113.5";
  h.deviceId = "dev-1";
  h.sessionUser = null;
  h.pending = null;
  h.pendingSet.length = 0;
  h.pendingCleared = 0;
  h.codeRow = null;
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

/** A server action that ends in `redirect()` throws; this turns that into a comparable result. */
async function followRedirect<T extends { status: string }>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) {
      return { status: "redirected" as const, to: error.message.slice("redirect:".length) };
    }
    throw error;
  }
}

describe("requestPasswordResetAction", () => {
  const request = () =>
    followRedirect(() =>
      requestPasswordResetAction({ status: "idle" }, form({ email: "who@example.test", ...OK })),
    );

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
    expect(h.sent).toEqual([
      [
        "auth/code-email",
        {
          codeId: "c1",
          to: "who@example.test",
          locale: "en",
          purpose: "password_reset",
          code: "123456",
          name: "U",
        },
      ],
    ]);
    expect(unknown).toEqual(known);
    expect(unknown).toEqual({ status: "redirected", to: "/reset-password" });
    // The pending identifier lives in a server-side cookie, the same for both.
    expect(h.pendingSet).toEqual(["who@example.test", "who@example.test"]);
  });

  it("uses the user's saved locale over the request locale", async () => {
    h.user = { id: "u1", name: "U", email: "who@example.test", locale: "ar" };
    await request();
    expect(h.sent[0]).toMatchObject(["auth/code-email", { locale: "ar" }]);
  });

  it("answers the same codeSent when the send throws", async () => {
    h.user = undefined;
    const unknown = await request();
    h.user = { id: "u1", name: "U", email: "who@example.test" };
    h.sendError = new Error("smtp down");
    const known = await request();
    expect(known).toEqual(unknown);
    expect(known.status).toBe("redirected");
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
    expect(result).toMatchObject({ status: "error", message: en.auth.states.codeInvalid });
  });

  it("verifies against verification_codes and rejects an invalid code", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    const result = await reset();
    expect(h.verify).toHaveBeenCalledWith("u1", "password_reset", "123456");
    expect(result).toMatchObject({ status: "error", message: en.auth.states.codeInvalid });
  });

  it("takes the email from the pending cookie when the form has none", async () => {
    h.pending = { email: "who@example.test", issuedAt: Date.now() };
    h.user = { id: "u1", email: "who@example.test" };
    await resetPasswordAction(
      { status: "idle" },
      form({ code: "123456", password: "a-new-pass-1" }),
    );
    expect(h.verify).toHaveBeenCalledWith("u1", "password_reset", "123456");
  });

  it("with neither a form email nor a pending cookie answers codeInvalid", async () => {
    const result = await resetPasswordAction(
      { status: "idle" },
      form({ code: "123456", password: "a-new-pass-1" }),
    );
    expect(result).toMatchObject({ status: "error", message: en.auth.states.codeInvalid });
    expect(h.verify).not.toHaveBeenCalled();
  });
});

describe("captcha in the actions", () => {
  const signUpForm = (token?: string) =>
    form({
      name: "Sam Student",
      email: "sam@example.test",
      password: "a-long-password-1",
      date_of_birth: "2000-01-01",
      role: "student",
      ...(token === undefined ? {} : { captcha_token: token }),
    });

  it("sign-up with a failed or missing captcha creates no user and keeps the form values", async () => {
    for (const token of ["fail", "", undefined]) {
      const result = await signUpAction({ status: "idle" }, signUpForm(token));
      expect(result).toMatchObject({ status: "error", message: en.auth.states.captchaFailed });
      expect(result.values?.email).toBe("sam@example.test");
    }
    expect(h.signUp).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("sign-up with a passing captcha goes on to create the user", async () => {
    await signUpAction({ status: "idle" }, signUpForm("fake-ok")).catch(() => undefined);
    expect(h.signUp).toHaveBeenCalledTimes(1);
  });

  it("a reset request with a failed captcha issues nothing and sends nothing", async () => {
    h.user = { id: "u1", name: "U", email: "who@example.test" };
    const result = await requestPasswordResetAction(
      { status: "idle" },
      form({ email: "who@example.test", captcha_token: "fail" }),
    );
    expect(result).toMatchObject({ status: "error", message: en.auth.states.captchaFailed });
    expect(h.issue).not.toHaveBeenCalled();
    expect(h.decoy).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
  });

  it("a reset request without a captcha is refused the same way", async () => {
    const result = await requestPasswordResetAction(
      { status: "idle" },
      form({ email: "who@example.test" }),
    );
    expect(result).toMatchObject({ status: "error", message: en.auth.states.captchaFailed });
  });

  it("sign-in asks for the widget from the 4th attempt and accepts a passing token", async () => {
    const attempt = (token?: string) =>
      signInAction(
        { status: "idle" },
        form({
          identifier: "nobody@example.test",
          password: "wrong pass 1",
          ...(token ? { captcha_token: token } : {}),
        }),
      );
    for (let i = 0; i < 3; i++) {
      expect((await attempt()).captchaRequired).toBeUndefined();
    }
    expect(await attempt()).toMatchObject({
      message: en.auth.states.captchaFailed,
      captchaRequired: true,
    });
    expect(await attempt("fail")).toMatchObject({
      message: en.auth.states.captchaFailed,
      captchaRequired: true,
    });
    const passed = await attempt("fake-ok");
    expect(passed.message).toBe(en.auth.errors.credentials);
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
    // From the 4th attempt a token is required; without one the form is told to show the widget.
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
    const submit = () => signUpAction({ status: "idle" }, form({ ...OK }));
    for (let i = 0; i < 5; i++) {
      expect((await submit()).message).toBe(en.auth.errors.invalid);
    }
    const blocked = await submit();
    expect(blocked).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect(blocked.retryAt).toBeGreaterThan(Date.now());
  });

  it("rate-limits code requests per email and answers known and unknown emails alike", async () => {
    const request = () =>
      followRedirect(() =>
        requestPasswordResetAction({ status: "idle" }, form({ email: "who@example.test", ...OK })),
      );
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

describe("sign-up issues an email verification code", () => {
  const signUpForm = () =>
    form({
      name: "Sam Student",
      email: "sam@example.test",
      password: "a-long-password-1",
      date_of_birth: "2000-01-01",
      role: "student",
      ...OK,
    });

  it("queues the code email and lands on /verify-email", async () => {
    h.signUp?.mockResolvedValueOnce({ ok: true, userId: "u1" });
    h.user = { id: "u1", name: "Sam", email: "sam@example.test", locale: null };
    const result = await followRedirect(() => signUpAction({ status: "idle" }, signUpForm()));
    expect(result).toEqual({ status: "redirected", to: "/verify-email" });
    expect(h.calls).toContain("create:u1");
    expect(h.issue).toHaveBeenCalledWith("u1", "email_verify");
    expect(h.sent).toEqual([
      [
        "auth/code-email",
        expect.objectContaining({ purpose: "email_verify", to: "sam@example.test", locale: "en" }),
      ],
    ]);
  });

  it("still signs the user in and lands on /verify-email when the enqueue throws", async () => {
    h.signUp?.mockResolvedValueOnce({ ok: true, userId: "u1" });
    h.user = { id: "u1", name: "Sam", email: "sam@example.test", locale: null };
    h.sendError = new Error("inngest down");
    const result = await followRedirect(() => signUpAction({ status: "idle" }, signUpForm()));
    expect(result).toEqual({ status: "redirected", to: "/verify-email" });
  });
});

describe("verifyEmailAction", () => {
  const submit = (code: string) => verifyEmailAction({ status: "idle" }, form({ code }));

  it("sends anonymous visitors to sign in", async () => {
    await expect(submit("123456")).rejects.toThrow("redirect:/sign-in");
  });

  it("answers codeInvalid for a wrong code and for anything that is not 6 digits", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    expect(await submit("123456")).toMatchObject({
      status: "error",
      message: en.auth.states.codeInvalid,
    });
    expect(h.verify).toHaveBeenCalledWith("u1", "email_verify", "123456");
    h.verify.mockClear();
    expect(await submit("12ab")).toMatchObject({
      status: "error",
      message: en.auth.states.codeInvalid,
    });
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("confirms the email and answers verified on the right code", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    h.verify.mockResolvedValueOnce({ ok: true, codeId: "c1" } as never);
    expect(await submit("123456")).toMatchObject({
      status: "success",
      message: en.auth.states.verified,
    });
    expect(h.calls).toContain("verified");
  });

  it("is rate-limited per account before it touches the code", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    for (let i = 0; i < 10; i++) await submit("123456");
    h.verify.mockClear();
    const blocked = await submit("123456");
    expect(blocked).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect(blocked.retryAt).toBeGreaterThan(Date.now());
    expect(h.verify).not.toHaveBeenCalled();
  });
});

describe("resendCodeAction", () => {
  const resend = (purpose: string) => resendCodeAction({ status: "idle" }, form({ purpose }));
  const known = { id: "u1", name: "U", email: "u@example.test", locale: null };

  it("refuses a resend inside the cooldown and tells the form when it opens", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    h.user = known;
    h.codeRow = { emailStatus: "sent", createdAt: new Date() };
    const result = await resend("email_verify");
    expect(result).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect(result.retryAt).toBeGreaterThan(Date.now());
    expect(h.issue).not.toHaveBeenCalled();
  });

  it("issues a fresh verification code and answers codeSent after the cooldown", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    h.user = known;
    h.codeRow = { emailStatus: "failed", createdAt: new Date(Date.now() - 5 * 60_000) };
    const result = await resend("email_verify");
    expect(result).toMatchObject({ status: "success", message: en.auth.states.codeSent });
    expect(h.issue).toHaveBeenCalledWith("u1", "email_verify");
    expect(h.sent[0]).toMatchObject(["auth/code-email", { purpose: "email_verify" }]);
  });

  it("limits resends with the code-send limits", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    h.user = known;
    h.codeRow = null;
    for (let i = 0; i < 3; i++) await resend("email_verify");
    expect(await resend("email_verify")).toMatchObject({
      status: "error",
      message: en.auth.states.rateLimited,
    });
  });

  it("needs a pending reset to resend a reset code", async () => {
    expect(await resend("password_reset")).toMatchObject({
      status: "error",
      message: en.auth.states.codeInvalid,
    });
    expect(h.issue).not.toHaveBeenCalled();
  });

  it("answers a pending reset for a known and an unknown email alike", async () => {
    h.pending = { email: "who@example.test", issuedAt: Date.now() - 5 * 60_000 };
    h.user = undefined;
    const unknown = await resend("password_reset");
    expect(h.decoy).toHaveBeenCalledWith("password_reset");
    h.memory?.hits.clear();
    h.user = { ...known, email: "who@example.test" };
    const answered = await resend("password_reset");
    expect(h.issue).toHaveBeenCalledWith("u1", "password_reset");
    expect(answered).toEqual(unknown);
    expect(answered).toMatchObject({ status: "success", message: en.auth.states.codeSent });
    expect(h.pendingSet).toEqual(["who@example.test", "who@example.test"]);
  });
});
