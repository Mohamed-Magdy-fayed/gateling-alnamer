import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { setClockForTests } from "@/server/clock";

// The code actions: password reset, email verification and resend. The fake world lives in actions.test-harness.ts.

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

const { h, OK, NOW, now, runAfter, form, resetHarness, followRedirect } = await import(
  "./actions.test-harness"
);
const { requestPasswordResetAction, resendCodeAction, resetPasswordAction, verifyEmailAction } =
  await import("./actions");

beforeEach(resetHarness);
afterAll(() => setClockForTests(null));

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
    expect(h.issue).toHaveBeenCalledWith(
      "u1",
      "password_reset",
      undefined,
      undefined,
      "rh:nonce-2",
    );
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
    // A typed email only reaches codes with no requester (A8 L2).
    expect(h.verify).toHaveBeenCalledWith(
      "u1",
      "password_reset",
      "123456",
      expect.anything(),
      null,
    );
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
    h.pending = { email: "who@example.test", issuedAt: now(), nonce: "mine" };
    h.user = { id: "u1", email: "who@example.test" };
    await resetPasswordAction(
      { status: "idle" },
      form({ code: "123456", password: "a-new-pass-1" }),
    );
    // Only this browser's codes are checked (A8 L2).
    expect(h.verify).toHaveBeenCalledWith(
      "u1",
      "password_reset",
      "123456",
      expect.anything(),
      "rh:mine",
    );
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
    h.known.add("dev-1");
    h.known.add("dev-victim");
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
      h.known.add(h.deviceId);
      await reset();
    }
    h.deviceId = "dev-victim";
    h.known.add("dev-victim");
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

  it("a fresh, unknown device id does not reset the pair lock (D36 for codes, A8 L2)", async () => {
    h.user = { id: "u1", email: "who@example.test" };
    for (let i = 0; i < 10; i++) {
      h.deviceId = `minted-${i}`;
      await reset();
    }
    const verifies = h.verify.mock.calls.length;
    h.deviceId = "minted-new";
    expect(await reset()).toMatchObject({ message: en.auth.states.rateLimited });
    expect(h.verify.mock.calls.length).toBe(verifies);
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

describe("verifyEmailAction", () => {
  const submit = (code: string) => verifyEmailAction({ status: "idle" }, form({ code }));

  it("sends anonymous visitors to sign in", async () => {
    await expect(submit("123456")).rejects.toThrow("redirect:/sign-in");
  });

  it("does not act for a staff session that has not passed two-factor (A8 L4)", async () => {
    h.sessionUser = { id: "t1", email: "t@example.test", role: "teacher" };
    await expect(submit("123456")).rejects.toThrow("redirect:/sign-in");
    expect(h.verify).not.toHaveBeenCalled();
    h.sessionVerified = true;
    h.verify.mockResolvedValueOnce({ ok: true, codeId: "c1" });
    expect(await submit("123456")).toMatchObject({ status: "success" });
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

  it("does not send for a staff session that has not passed two-factor (A8 L4)", async () => {
    h.sessionUser = { id: "t1", email: "t@example.test", role: "admin" };
    await expect(resend("email_verify")).rejects.toThrow("redirect:/sign-in");
    expect(h.issue).not.toHaveBeenCalled();
  });

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
    expect(h.issue).toHaveBeenCalledWith("u1", "email_verify", undefined, undefined, undefined);
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
    h.pending = { email: "who@example.test", issuedAt: now() - 5 * 60_000, nonce: "mine" };
    h.user = undefined;
    const unknown = await resend("password_reset");
    await runAfter();
    expect(h.issue).not.toHaveBeenCalled();
    h.memory?.hits.clear();
    h.user = { ...known, email: "who@example.test" };
    const answered = await resend("password_reset");
    expect(h.issue).not.toHaveBeenCalled();
    await runAfter();
    expect(h.issue).toHaveBeenCalledWith("u1", "password_reset", undefined, undefined, "rh:mine");
    // A resend keeps the same requester, so earlier codes still verify (A8 L2).
    expect(h.pendingNonces.at(-1)).toBe("mine");
    expect(answered).toEqual(unknown);
    expect(answered).toMatchObject({ status: "success", message: en.auth.states.codeSent });
    expect(h.pendingSet).toEqual(["who@example.test", "who@example.test"]);
  });
});
