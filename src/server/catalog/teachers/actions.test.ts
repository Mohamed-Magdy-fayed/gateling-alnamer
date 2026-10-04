import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";

const h = vi.hoisted(() => ({
  current: null as null | { id: string },
  acting: null as null | { id: string; role: string },
  guard: { ok: true } as { ok: true } | { blocked: "rateLimited" },
  captcha: true,
  enforced: true,
  applyResult: { ok: true, userId: "u-new" } as
    | { ok: true; userId: string }
    | { ok: false; code: "duplicate" }
    | { ok: false; code: "fields"; fields: string[] },
  redeemResult: { ok: true, userId: "u-inv" } as
    | { ok: true; userId: string }
    | { ok: false; reason: "invalid_link" | "taken" }
    | { ok: false; reason: "fields"; fields: Array<"password" | "date_of_birth"> },
  redeemed: [] as unknown[],
  acceptResult: { ok: true } as { ok: true } | { ok: false; reason: string },
  accepted: [] as unknown[][],
  sessions: [] as string[],
  mails: [] as unknown[][],
  codes: [] as unknown[][],
  revalidated: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    h.revalidated.push(path);
  },
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({ t: en, locale: "en" as const }),
}));
vi.mock("@/server/auth/abuse", () => ({ guardSignUp: async () => h.guard }));
vi.mock("@/server/auth/acting-user", () => ({ getActingUser: async () => h.acting }));
vi.mock("@/server/auth/captcha", () => ({ verifyCaptcha: async () => h.captcha }));
vi.mock("@/server/auth/request-context", () => ({
  requestContext: async () => ({ ip: "203.0.113.9" }),
}));
vi.mock("@/server/auth/session", () => ({
  getCurrentUser: async () => h.current,
  destroySession: async () => {
    h.sessions.push("destroy");
  },
  createSession: async (userId: string) => {
    h.sessions.push(`create:${userId}`);
  },
}));
vi.mock("@/server/auth/staff-session", () => ({ twoFactorEnforced: () => h.enforced }));
vi.mock("@/server/auth/form-kit", () => ({
  fields: (formData: FormData) => Object.fromEntries(formData.entries()),
  echo: (raw: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(raw).filter(([key, value]) => typeof value === "string" && key !== "password"),
    ),
  captchaToken: () => undefined,
  blockedState: () => ({ status: "error", message: "blocked" }),
  sendAfterResponse: (task: () => Promise<void>) => {
    void task();
  },
  sendVerificationCode: async (...args: unknown[]) => {
    h.codes.push(args);
  },
}));
vi.mock("./apply", () => ({ applyAsTeacher: async () => h.applyResult }));
vi.mock("./emails", () => ({
  sendTeacherEmail: async (...args: unknown[]) => {
    h.mails.push(args);
  },
}));
vi.mock("./terms", () => ({
  acceptTeacherTerms: async (...args: unknown[]) => {
    h.accepted.push(args);
    return h.acceptResult;
  },
}));
vi.mock("./invites", () => ({
  redeemTeacherInvite: async (input: unknown) => {
    h.redeemed.push(input);
    return h.redeemResult;
  },
}));

const { acceptTermsAction, applyTeacherAction, redeemInviteAction } = await import("./actions");

const idle = { status: "idle" as const };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const applyForm = () =>
  form({ name: " Mona ", email: " m@example.com ", password: "Pass-word-1", note: "Physics" });
const redeemForm = () =>
  form({ token: "tok_1", password: "Pass-word-1", date_of_birth: "1990-01-02" });

beforeEach(() => {
  h.current = null;
  h.acting = null;
  h.guard = { ok: true };
  h.captcha = true;
  h.enforced = true;
  h.applyResult = { ok: true, userId: "u-new" };
  h.redeemResult = { ok: true, userId: "u-inv" };
  h.acceptResult = { ok: true };
  for (const list of [h.redeemed, h.accepted, h.sessions, h.mails, h.codes, h.revalidated]) {
    list.length = 0;
  }
});

describe("applyTeacherAction", () => {
  it("sends a signed-in visitor to the dashboard (one account, one role)", async () => {
    h.current = { id: "someone" };
    await expect(applyTeacherAction(idle, applyForm())).rejects.toThrow("redirect:/dashboard");
  });

  it("starts a fresh session, mails the code and the receipt, then two-factor enrolment", async () => {
    await expect(applyTeacherAction(idle, applyForm())).rejects.toThrow(
      "redirect:/two-factor/setup?next=%2Fverify-email",
    );
    expect(h.sessions).toEqual(["destroy", "create:u-new"]);
    expect(h.codes).toEqual([["u-new", "en"]]);
    expect(h.mails).toEqual([["m@example.com", "en", "en", { kind: "applied", name: "Mona" }]]);
  });

  it("goes straight to the email confirmation when two-factor is off", async () => {
    h.enforced = false;
    await expect(applyTeacherAction(idle, applyForm())).rejects.toThrow("redirect:/verify-email");
  });

  it("answers a taken email like sign-up does, with the reset offer", async () => {
    h.applyResult = { ok: false, code: "duplicate" };
    const state = await applyTeacherAction(idle, applyForm());
    expect(state).toMatchObject({
      status: "error",
      message: en.auth.errors.checkDetails,
      offerReset: true,
    });
    expect(h.sessions).toEqual([]);
  });

  it("maps field errors to their messages and never echoes the password", async () => {
    h.applyResult = { ok: false, code: "fields", fields: ["note", "date_of_birth"] };
    const state = await applyTeacherAction(idle, applyForm());
    expect(state.fieldErrors).toEqual({
      note: en.teachers.apply.noteError,
      date_of_birth: en.teachers.apply.dobError,
    });
    expect(state.values).not.toHaveProperty("password");
  });

  it("stops at a failed captcha", async () => {
    h.captcha = false;
    const state = await applyTeacherAction(idle, applyForm());
    expect(state).toMatchObject({ status: "error", message: en.auth.states.captchaFailed });
  });
});

describe("redeemInviteAction", () => {
  it("sends a signed-in visitor away without touching the invite", async () => {
    h.current = { id: "someone" };
    await expect(redeemInviteAction(idle, redeemForm())).rejects.toThrow("redirect:/dashboard");
    expect(h.redeemed).toEqual([]);
  });

  it("is rate limited like sign-up", async () => {
    h.guard = { blocked: "rateLimited" };
    const state = await redeemInviteAction(idle, redeemForm());
    expect(state).toMatchObject({ status: "error", message: "blocked" });
    expect(h.redeemed).toEqual([]);
  });

  it("creates the session and goes to two-factor enrolment, then the dashboard", async () => {
    await expect(redeemInviteAction(idle, redeemForm())).rejects.toThrow(
      "redirect:/two-factor/setup?next=%2Fdashboard",
    );
    expect(h.redeemed).toEqual([
      { token: "tok_1", password: "Pass-word-1", dateOfBirth: "1990-01-02", locale: "en" },
    ]);
    expect(h.sessions).toEqual(["destroy", "create:u-inv"]);
  });

  it.each([
    ["invalid_link", en.teachers.invite.invalid, false],
    ["taken", en.teachers.invite.taken, true],
  ] as const)("answers %s with its message", async (reason, message, offerReset) => {
    h.redeemResult = { ok: false, reason };
    const state = await redeemInviteAction(idle, redeemForm());
    expect(state).toEqual({ status: "error", message, offerReset });
    expect(h.sessions).toEqual([]);
  });

  it("maps field errors", async () => {
    h.redeemResult = { ok: false, reason: "fields", fields: ["password", "date_of_birth"] };
    const state = await redeemInviteAction(idle, redeemForm());
    expect(state.fieldErrors).toEqual({
      password: en.auth.errors.field.password,
      date_of_birth: en.teachers.apply.dobError,
    });
  });
});

describe("acceptTermsAction", () => {
  it("refuses anyone but an acting teacher, and oversized ids", async () => {
    h.acting = { id: "s-1", role: "student" };
    expect(await acceptTermsAction("teacher-placeholder-1")).toEqual({
      ok: false,
      reason: "error",
    });
    h.acting = { id: "t-1", role: "teacher" };
    expect(await acceptTermsAction("x".repeat(65))).toEqual({ ok: false, reason: "error" });
    expect(h.accepted).toEqual([]);
  });

  it("accepts the shown version and refreshes the dashboard", async () => {
    h.acting = { id: "t-1", role: "teacher" };
    expect(await acceptTermsAction("teacher-placeholder-1")).toEqual({ ok: true });
    expect(h.accepted).toEqual([["t-1", "teacher-placeholder-1"]]);
    expect(h.revalidated).toEqual(["/dashboard"]);
  });

  it("reports a changed version as stale", async () => {
    h.acting = { id: "t-1", role: "teacher" };
    h.acceptResult = { ok: false, reason: "stale_version" };
    expect(await acceptTermsAction("teacher-placeholder-1")).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});
