import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatTime } from "@/i18n/config";
import { en } from "@/i18n/en";
import { setClockForTests } from "@/server/clock";
import type { FormState } from "./actions";
import { hashPassword } from "./password";

// Sign-in and sign-up actions, with their captcha and abuse guards. The fake world lives in actions.test-harness.ts.

vi.mock("next/server", async () => (await import("./actions.test-harness")).mocks.nextServer());
vi.mock("next/navigation", async () => (await import("./actions.test-harness")).mocks.navigation());
vi.mock("@/i18n/server", async () => (await import("./actions.test-harness")).mocks.i18n());
vi.mock("@/server/rate-limit", async () =>
  (await import("./actions.test-harness")).mocks.rateLimit(),
);
vi.mock("./captcha", async () => (await import("./actions.test-harness")).mocks.captcha());
vi.mock("./sign-up", async (importOriginal) =>
  (await import("./actions.test-harness")).mocks.signUp(await importOriginal()),
);
vi.mock("./known-device", async () => (await import("./actions.test-harness")).mocks.knownDevice());
vi.mock("./session-invalidate", async () =>
  (await import("./actions.test-harness")).mocks.sessionInvalidate(),
);
vi.mock("./request-context", async () =>
  (await import("./actions.test-harness")).mocks.requestContext(),
);
vi.mock("@/server/devices/sign-in", async () =>
  (await import("./actions.test-harness")).mocks.deviceSignIn(),
);
vi.mock("next/cache", async () => (await import("./actions.test-harness")).mocks.cache());
vi.mock("./pending-reset", async () =>
  (await import("./actions.test-harness")).mocks.pendingReset(),
);
vi.mock("./code-status", async () => (await import("./actions.test-harness")).mocks.codeStatus());
vi.mock("@/server/db", async () => (await import("./actions.test-harness")).mocks.db());
vi.mock("@/server/jobs/send", async () => (await import("./actions.test-harness")).mocks.jobs());
vi.mock("./codes", async () => (await import("./actions.test-harness")).mocks.codes());
vi.mock("./session", async () => (await import("./actions.test-harness")).mocks.session());

const { h, OK, now, runAfter, form, resetHarness, followRedirect } = await import(
  "./actions.test-harness"
);
const { requestPasswordResetAction, signInAction, signUpAction } = await import("./actions");

beforeEach(resetHarness);
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
    // Any earlier session on this browser ends first (A8 L5).
    expect(h.calls.filter((c) => c === "destroy" || c.startsWith("create"))).toEqual([
      "destroy",
      "create:u1",
    ]);
    expect(h.issue).toHaveBeenCalledWith("u1", "email_verify", undefined, undefined, undefined);
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
