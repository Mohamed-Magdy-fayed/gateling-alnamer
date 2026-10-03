import { afterAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { formatTime } from "@/i18n/config";
import { en } from "@/i18n/en";
import { setClockForTests } from "@/server/clock";
import type { FormState } from "./actions";
import { hashPassword } from "./password";

const h = vi.hoisted(() => ({
  user: undefined as unknown,
  calls: [] as string[],
  sent: [] as unknown[],
  sendError: null as null | Error,
  after: [] as Array<() => Promise<void> | void>,
  issue: vi.fn(async (_userId: string, _purpose: string) => ({ codeId: "c1", code: "123456" })),
  verify: vi.fn(
    async (
      _userId: string,
      _purpose: string,
      _code: string,
      _executor?: unknown,
    ): Promise<{ ok: false; reason: "invalid" } | { ok: true; codeId: string }> => ({
      ok: false,
      reason: "invalid",
    }),
  ),
  verifyDecoy: vi.fn(async (_purpose: string, _code: string) => undefined),
  memory: null as null | { hits: Map<string, number[]> },
  signUp: null as null | Mock<typeof import("./sign-up").signUpUser>,
  ip: "203.0.113.5",
  deviceId: "dev-1" as string | null,
  gate: { kind: "allowed", deviceId: null, overLimit: false } as
    | { kind: "allowed"; deviceId: string | null; overLimit: boolean }
    | { kind: "blocked" },
  gateCalls: [] as unknown[],
  sessionUser: null as null | { id: string; email: string | null },
  pending: null as null | { email: string; issuedAt: number },
  pendingSet: [] as string[],
  pendingCleared: 0,
  codeRow: null as null | { emailStatus: "queued" | "sent" | "failed"; createdAt: Date },
  contexts: 0,
  known: new Set<string>(),
  seen: [] as string[],
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void> | void) => {
    h.after.push(task);
  },
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
vi.mock("./known-device", () => ({
  isKnownDevice: async (id: string) => h.known.has(id),
  markDeviceSeen: async (id: string) => {
    h.seen.push(id);
  },
}));
vi.mock("./session-invalidate", () => ({
  deleteUserSessionsIn: async () => {
    h.calls.push("sessions:delete");
    return ["hash-1"];
  },
  purgeSessionCache: async () => {
    h.calls.push("sessions:purge");
  },
}));
vi.mock("./request-context", () => ({
  requestContext: async () => {
    h.contexts += 1;
    return { ip: h.ip, deviceId: h.deviceId, deviceKey: "key-1", userAgent: "UA", secure: false };
  },
}));
vi.mock("@/server/devices/sign-in", () => ({
  gateDevice: async (...args: unknown[]) => {
    h.gateCalls.push(args);
    return h.gate;
  },
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
const tx = {
  delete: () => ({ where: async () => undefined }),
  insert: () => ({
    values: () => ({
      onConflictDoUpdate: async () => {
        h.calls.push("credential");
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: async () => {
        h.calls.push("verified");
      },
    }),
  }),
};
vi.mock("@/server/db", () => ({
  db: () => ({
    query: { users: { findFirst: async () => h.user } },
    transaction: async (run: (executor: typeof tx) => Promise<unknown>) => {
      h.calls.push("tx:begin");
      const result = await run(tx);
      h.calls.push("tx:end");
      return result;
    },
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
  verifyCode: async (...args: Parameters<typeof h.verify>) => {
    h.calls.push(`verify:${args[0]}`);
    return h.verify(...args);
  },
  verifyCodeDecoy: h.verifyDecoy,
  markCodeEmailSent: async () => undefined,
  deleteCode: async () => undefined,
}));
vi.mock("./session", () => ({
  getCurrentUser: async () => h.sessionUser,
  createSession: async (userId: string, options?: { deviceId?: string | null }) => {
    h.calls.push(options?.deviceId ? `create:${userId}:${options.deviceId}` : `create:${userId}`);
  },
  destroySession: async () => {
    h.calls.push("destroy");
  },
  invalidateUserSessions: async () => undefined,
}));

const OK = { captcha_token: "fake-ok" };
/** Every time in this file comes from the pinned clock, so no assertion races a minute or ms boundary. */
const NOW = new Date("2030-03-01T09:00:00.000Z");
const now = () => NOW.getTime();

/** Runs what the actions handed to `after()`, as Next does once the response is sent. */
async function runAfter(): Promise<void> {
  const tasks = h.after.splice(0);
  for (const task of tasks) await task();
}
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
  setClockForTests(NOW);
  h.calls.length = 0;
  h.after.length = 0;
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
  h.contexts = 0;
  h.known.clear();
  h.seen.length = 0;
  h.gate = { kind: "allowed", deviceId: null, overLimit: false };
  h.gateCalls.length = 0;
  vi.clearAllMocks();
});

afterAll(() => setClockForTests(null));

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

  describe("device ids and the pair lock (D36)", () => {
    const attempt = (password = "wrong pass 1") =>
      signInAction({ status: "idle" }, form({ identifier: "victim@example.test", password }));
    const locked = (state: FormState) =>
      state.tone === "danger" && state.offerReset === true && state.retryAt !== undefined;

    it("an empty post validates before requestContext, so it mints no device id", async () => {
      await signInAction({ status: "idle" }, form({}));
      await signInAction({ status: "idle" }, form({ identifier: "", password: "" }));
      expect(h.contexts).toBe(0);
    });

    it("12 failures with 12 different unknown dids from one IP lock the pair", async () => {
      const results: FormState[] = [];
      for (let i = 0; i < 12; i++) {
        h.deviceId = `did-fresh-${i}`;
        results.push(await attempt());
      }
      expect(results.slice(0, 10).some(locked)).toBe(false);
      expect(locked(results[10] as FormState)).toBe(true);
      expect(locked(results[11] as FormState)).toBe(true);
    });

    it("a known returning device keeps its own pair, whatever IP it comes from", async () => {
      h.known.add("did-real");
      h.deviceId = "did-real";
      for (let i = 0; i < 10; i++) {
        h.ip = `198.51.100.${i + 1}`;
        expect(locked(await attempt())).toBe(false);
      }
      h.ip = "198.51.100.200";
      expect(locked(await attempt())).toBe(true);
      // Another, unknown device on the same address is a different pair and is not locked.
      h.deviceId = "did-other";
      expect(locked(await attempt())).toBe(false);
    });

    it("marks the device id seen only after a successful sign-in", async () => {
      h.deviceId = "did-real";
      await attempt();
      expect(h.seen).toEqual([]);
      h.user = {
        id: "u1",
        status: "active",
        credentials: { passwordHash: await hashPassword("right pass 1"), passwordSalt: null },
      };
      await expect(attempt("right pass 1")).rejects.toThrow("redirect:/dashboard");
      expect(h.seen).toEqual(["key-1"]);
    });
  });

  describe("device limit", () => {
    const signIn = () =>
      signInAction(
        { status: "idle" },
        form({ identifier: "u@example.test", password: "right pass 1" }),
      );
    beforeEach(async () => {
      h.user = {
        id: "u1",
        status: "active",
        credentials: { passwordHash: await hashPassword("right pass 1"), passwordSalt: null },
      };
    });

    it("hands the cookie device key and user agent to the gate and stores the device on the session", async () => {
      h.gate = { kind: "allowed", deviceId: "dev-9", overLimit: false };
      await expect(signIn()).rejects.toThrow("redirect:/dashboard");
      expect(h.gateCalls).toEqual([["u1", { deviceKey: "key-1", userAgent: "UA", secure: false }]]);
      expect(h.calls).toEqual(["destroy", "create:u1:dev-9"]);
    });

    it("over the limit in soft mode signs in and flags the dashboard", async () => {
      h.gate = { kind: "allowed", deviceId: "dev-9", overLimit: true };
      await expect(signIn()).rejects.toThrow("redirect:/dashboard?notice=device-over");
      expect(h.calls).toEqual(["destroy", "create:u1:dev-9"]);
    });

    it("a blocked device gets no session and goes to /devices/blocked", async () => {
      h.gate = { kind: "blocked" };
      await expect(signIn()).rejects.toThrow("redirect:/devices/blocked");
      expect(h.calls).toEqual(["destroy"]);
    });
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

  it("does the same in-request work for a known and an unknown email: the send runs after the response", async () => {
    h.user = undefined;
    const unknown = await request();
    await runAfter();
    expect(h.issue).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);

    h.user = { id: "u1", name: "U", email: "who@example.test" };
    const known = await request();
    // Nothing slow has happened yet: no code row, no mail, so both answers took the same path.
    expect(h.issue).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
    expect(h.after).toHaveLength(1);
    await runAfter();
    expect(h.issue).toHaveBeenCalledWith("u1", "password_reset");
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
    await runAfter();
    expect(h.sent[0]).toMatchObject(["auth/code-email", { locale: "ar" }]);
  });

  it("answers the same codeSent when the send throws", async () => {
    h.user = undefined;
    const unknown = await request();
    h.user = { id: "u1", name: "U", email: "who@example.test" };
    h.sendError = new Error("smtp down");
    const known = await request();
    await expect(runAfter()).resolves.toBeUndefined();
    expect(known).toEqual(unknown);
    expect(known.status).toBe("redirected");
  });
});

describe("resetPasswordAction", () => {
  const reset = (extra: Record<string, string> = {}) =>
    resetPasswordAction(
      { status: "idle" },
      form({ email: "who@example.test", code: "123456", password: "a-new-pass-1", ...extra }),
    );

  it("spends a decoy verify and answers with the code error for an unknown email", async () => {
    h.user = undefined;
    const result = await reset();
    expect(h.verifyDecoy).toHaveBeenCalledWith("password_reset", "123456");
    expect(h.verify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error", message: en.auth.states.codeInvalid });
  });

  it("verifies against verification_codes inside a transaction and rejects an invalid code", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    const result = await reset();
    expect(h.verify).toHaveBeenCalledWith("u1", "password_reset", "123456", expect.anything());
    expect(h.calls).toEqual(["tx:begin", "verify:u1", "tx:end"]);
    expect(result).toMatchObject({ status: "error", message: en.auth.states.codeInvalid });
  });

  it("consumes the code and writes the credential in one transaction", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    h.verify.mockResolvedValueOnce({ ok: true, codeId: "c1" });
    const result = await reset();
    expect(h.calls).toEqual([
      "tx:begin",
      "verify:u1",
      "credential",
      "sessions:delete",
      "tx:end",
      "sessions:purge",
    ]);
    expect(result).toMatchObject({ status: "success", message: en.auth.reset.done });
    expect(h.pendingCleared).toBe(1);
  });

  it("takes the email from the pending cookie when the form has none", async () => {
    h.pending = { email: "who@example.test", issuedAt: now() };
    h.user = { id: "u1", email: "who@example.test" };
    await resetPasswordAction(
      { status: "idle" },
      form({ code: "123456", password: "a-new-pass-1" }),
    );
    expect(h.verify).toHaveBeenCalledWith("u1", "password_reset", "123456", expect.anything());
  });

  it("with neither a form email nor a pending cookie answers codeInvalid", async () => {
    const result = await resetPasswordAction(
      { status: "idle" },
      form({ code: "123456", password: "a-new-pass-1" }),
    );
    expect(result).toMatchObject({ status: "error", message: en.auth.states.codeInvalid });
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("locks the (email, device) pair after 10 verifies, and a different device is not locked", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    for (let i = 0; i < 10; i++) await reset();
    const verifies = h.verify.mock.calls.length;
    const locked = await reset();
    expect(locked).toMatchObject({
      status: "error",
      tone: "warning",
      message: en.auth.states.rateLimited,
    });
    expect(locked.retryAt).toBeGreaterThan(now());
    expect(h.verify.mock.calls.length).toBe(verifies);
    h.deviceId = "dev-victim";
    await reset();
    expect(h.verify.mock.calls.length).toBe(verifies + 1);
  });

  it("asks every device for a captcha after 30 failed verifies on the email, and never blocks", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    for (let i = 0; i < 30; i++) {
      h.deviceId = `dev-${i}`;
      await reset();
    }
    h.deviceId = "dev-victim";
    const asked = await reset();
    expect(asked).toMatchObject({
      captchaRequired: true,
      tone: "danger",
      message: en.auth.states.captchaFailed,
    });
    const refused = await reset({ captcha_token: "fail" });
    expect(refused).toMatchObject({ captchaRequired: true });
    h.verify.mockResolvedValueOnce({ ok: true, codeId: "c1" });
    expect(await reset({ captcha_token: "fake-ok" })).toMatchObject({ status: "success" });
  });

  it("forgets the pair's failures after a successful reset", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    await reset();
    h.verify.mockResolvedValueOnce({ ok: true, codeId: "c1" });
    await reset();
    const keys = [...(h.memory?.hits.keys() ?? [])].filter((key) => key.startsWith("vlock:"));
    expect(keys).toEqual([]);
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
    await runAfter();
    expect(h.issue).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
  });

  it("a failed captcha does not spend the code-send budget", async () => {
    h.user = { id: "u1", name: "U", email: "who@example.test" };
    for (let i = 0; i < 6; i++) {
      await requestPasswordResetAction(
        { status: "idle" },
        form({ email: "who@example.test", captcha_token: "fail" }),
      );
    }
    const keys = [...(h.memory?.hits.keys() ?? [])].filter((key) => key.startsWith("rl:codesend:"));
    expect(keys).toEqual([]);
    const result = await followRedirect(() =>
      requestPasswordResetAction({ status: "idle" }, form({ email: "who@example.test", ...OK })),
    );
    expect(result).toEqual({ status: "redirected", to: "/reset-password" });
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
    const out: Array<Pick<FormState, "message" | "retryAt" | "offerReset" | "tone">> = [];
    for (let i = 0; i < 11; i++) {
      const { message, retryAt, offerReset, tone } = await wrongSignIn(identifier);
      out.push({ message, retryAt, offerReset, tone });
    }
    return out;
  }

  it("locks the (identifier, device) pair after 10 attempts and shows when it ends", async () => {
    const out = await sequence("nobody@example.test");
    expect(out.slice(0, 3).every((r) => r.message === en.auth.errors.credentials)).toBe(true);
    // From the 4th attempt a token is required; without one the form is told to show the widget.
    expect(out.slice(3, 10).every((r) => r.message === en.auth.states.captchaFailed)).toBe(true);
    const locked = out[10];
    expect(locked?.retryAt).toBeGreaterThan(now());
    expect(locked?.message).toBe(
      en.auth.states.lockout.replace("{time}", formatTime("en", new Date(locked?.retryAt ?? 0))),
    );
    expect(locked?.offerReset).toBe(true);
    expect(locked?.tone).toBe("danger");
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
    expect(blocked).toMatchObject({
      status: "error",
      tone: "warning",
      message: en.auth.states.rateLimited,
    });
    expect(blocked.retryAt).toBeGreaterThan(now());
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
    expect(h.verify).toHaveBeenCalledWith("u1", "email_verify", "123456", expect.anything());
    h.verify.mockClear();
    expect(await submit("12ab")).toMatchObject({
      status: "error",
      message: en.auth.states.codeInvalid,
    });
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("confirms the email and answers verified on the right code", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    h.verify.mockResolvedValueOnce({ ok: true, codeId: "c1" });
    expect(await submit("123456")).toMatchObject({
      status: "success",
      message: en.auth.states.verified,
    });
    // The code is consumed and email_verified_at set in one transaction.
    expect(h.calls).toEqual(["tx:begin", "verify:u1", "verified", "tx:end"]);
  });

  it("locks the (account, device) pair after 10 failed verifies before touching the code", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    for (let i = 0; i < 10; i++) await submit("123456");
    h.verify.mockClear();
    const blocked = await submit("123456");
    expect(blocked).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect(blocked.retryAt).toBeGreaterThan(now());
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("asks for a captcha after 30 failed verifies on the account, from any device", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    for (let i = 0; i < 30; i++) {
      h.deviceId = `dev-${i}`;
      await submit("123456");
    }
    h.deviceId = "dev-owner";
    h.verify.mockClear();
    expect(await submit("123456")).toMatchObject({ captchaRequired: true });
    expect(h.verify).not.toHaveBeenCalled();
    h.verify.mockResolvedValueOnce({ ok: true, codeId: "c1" });
    const withToken = verifyEmailAction({ status: "idle" }, form({ code: "123456", ...OK }));
    expect(await withToken).toMatchObject({ status: "success" });
  });
});

describe("resendCodeAction", () => {
  const resend = (purpose: string) => resendCodeAction({ status: "idle" }, form({ purpose }));
  const known = { id: "u1", name: "U", email: "u@example.test", locale: null };

  it("refuses a resend inside the cooldown and tells the form when it opens", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    h.user = known;
    h.codeRow = { emailStatus: "sent", createdAt: new Date(NOW) };
    const result = await resend("email_verify");
    expect(result).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect(result.retryAt).toBeGreaterThan(now());
    expect(h.issue).not.toHaveBeenCalled();
  });

  it("issues a fresh verification code and answers codeSent after the cooldown", async () => {
    h.sessionUser = { id: "u1", email: "u@example.test" };
    h.user = known;
    h.codeRow = { emailStatus: "failed", createdAt: new Date(now() - 5 * 60_000) };
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
    h.pending = { email: "who@example.test", issuedAt: now() - 5 * 60_000 };
    h.user = undefined;
    const unknown = await resend("password_reset");
    await runAfter();
    expect(h.issue).not.toHaveBeenCalled();
    h.memory?.hits.clear();
    h.user = { ...known, email: "who@example.test" };
    const answered = await resend("password_reset");
    expect(h.issue).not.toHaveBeenCalled();
    await runAfter();
    expect(h.issue).toHaveBeenCalledWith("u1", "password_reset");
    expect(answered).toEqual(unknown);
    expect(answered).toMatchObject({ status: "success", message: en.auth.states.codeSent });
    expect(h.pendingSet).toEqual(["who@example.test", "who@example.test"]);
  });
});
