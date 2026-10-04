import { beforeEach, describe, expect, it, vi } from "vitest";

type Session = {
  user: { id: string; role: string; status: string; name: string; email: string | null };
  tokenHash: string;
  twoFactorVerified: boolean;
};

const h = vi.hoisted(() => ({
  session: null as Session | null,
  cookies: [] as string[],
  confirm: vi.fn(),
  challenge: vi.fn(),
  regenerate: vi.fn(),
  stepUp: vi.fn(),
  enrolled: true,
  finishValid: true,
  removed: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/auth/session", () => ({
  getCurrentSession: async () => h.session,
  setSessionCookie: async (token: string) => {
    h.cookies.push(token);
  },
}));
vi.mock("@/server/auth/two-factor", () => ({
  confirmTotpSetup: h.confirm,
  verifyChallenge: h.challenge,
  regenerateRecoveryCodes: h.regenerate,
  stepUpSession: h.stepUp,
  twoFactorStatus: async () => ({ enrolled: h.enrolled }),
  finishToken: () => "finish-token",
  verifyFinishToken: () => h.finishValid,
}));
vi.mock("@/server/auth/passkeys", () => ({
  authenticationOptions: async () => ({ challenge: "c" }),
  registrationOptions: async () => ({ challenge: "r" }),
  verifyPasskeyChallenge: async () => ({ ok: false, reason: "invalid" }),
  finishRegistration: async () => ({ ok: true }),
  removePasskey: async (_userId: string, id: string) => {
    h.removed.push(id);
    return true;
  },
}));
vi.mock("@/server/auth/abuse", () => ({ guardPasskeyOptions: async () => ({ ok: true }) }));
vi.mock("@/server/auth/webauthn-rp", () => ({
  currentRelyingParty: async () => ({ rpID: "localhost", origin: "http://localhost:3410" }),
}));

const actions = await import("./actions");

const staff = (verified: boolean, role = "teacher", status = "active"): Session => ({
  user: { id: "t1", role, status, name: "T", email: "t@example.test" },
  tokenHash: "hash-1",
  twoFactorVerified: verified,
});
const rotated = { token: "new-token", expiresAt: new Date("2030-01-01T00:00:00Z") };

beforeEach(() => {
  h.session = null;
  h.cookies.length = 0;
  h.removed.length = 0;
  h.enrolled = true;
  h.finishValid = true;
  vi.clearAllMocks();
});

describe("who the two-factor screens act for", () => {
  it("refuses anyone but active staff, and oversized input, before any service call", async () => {
    for (const session of [null, staff(false, "student"), staff(false, "teacher", "suspended")]) {
      h.session = session;
      expect(await actions.confirmSetupAction("123456")).toEqual({ ok: false, reason: "error" });
      expect(await actions.challengeAction("123456")).toEqual({ ok: false, reason: "error" });
    }
    h.session = staff(false);
    expect(await actions.challengeAction("x".repeat(33))).toEqual({ ok: false, reason: "error" });
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.challenge).not.toHaveBeenCalled();
  });

  it("account-page actions need a verified staff session", async () => {
    h.session = staff(false);
    expect(await actions.regenerateCodesAction("123456")).toEqual({ ok: false, reason: "error" });
    expect(await actions.addPasskeyOptionsAction()).toBeNull();
    expect(await actions.removePasskeyAction("0190a6b2-0000-7000-8000-000000000001")).toEqual({
      ok: false,
      reason: "error",
    });
    expect(h.regenerate).not.toHaveBeenCalled();
    expect(h.removed).toEqual([]);
  });
});

describe("confirmSetupAction and finishSetupAction", () => {
  it("confirms with this session's token hash and hands back the codes and a finish token", async () => {
    h.session = staff(false);
    h.confirm.mockResolvedValueOnce({ ok: true, recoveryCodes: ["a", "b"] });
    expect(await actions.confirmSetupAction("123456")).toEqual({
      ok: true,
      recoveryCodes: ["a", "b"],
      finish: "finish-token",
    });
    expect(h.confirm).toHaveBeenCalledWith("t1", "hash-1", "123456");
    // No cookie yet: the step-up waits for Finish, so the codes are shown first.
    expect(h.cookies).toEqual([]);
  });

  it("maps a lock to locked and anything else to invalid", async () => {
    h.session = staff(false);
    h.confirm.mockResolvedValueOnce({ ok: false, reason: "locked" });
    expect(await actions.confirmSetupAction("123456")).toEqual({ ok: false, reason: "locked" });
    h.confirm.mockResolvedValueOnce({ ok: false, reason: "no_setup" });
    expect(await actions.confirmSetupAction("123456")).toEqual({ ok: false, reason: "invalid" });
  });

  it("Finish steps the session up only with a valid token and a confirmed enrolment", async () => {
    h.session = staff(false);
    h.finishValid = false;
    expect(await actions.finishSetupAction("t")).toEqual({ ok: false, reason: "error" });
    h.finishValid = true;
    h.enrolled = false;
    expect(await actions.finishSetupAction("t")).toEqual({ ok: false, reason: "error" });
    expect(h.stepUp).not.toHaveBeenCalled();
    h.enrolled = true;
    h.stepUp.mockResolvedValueOnce(rotated);
    expect(await actions.finishSetupAction("t")).toEqual({ ok: true });
    expect(h.cookies).toEqual(["new-token"]);
  });
});

describe("challengeAction", () => {
  it("sets the rotated cookie on success and nothing on failure", async () => {
    h.session = staff(false);
    h.challenge.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    expect(await actions.challengeAction("000000")).toEqual({ ok: false, reason: "invalid" });
    h.challenge.mockResolvedValueOnce({ ok: false, reason: "not_enrolled" });
    expect(await actions.challengeAction("000000")).toEqual({ ok: false, reason: "error" });
    expect(h.cookies).toEqual([]);
    h.challenge.mockResolvedValueOnce({ ok: true, rotated, usedRecoveryCode: false });
    expect(await actions.challengeAction("123456")).toEqual({ ok: true });
    expect(h.challenge).toHaveBeenLastCalledWith("t1", "hash-1", "123456");
    expect(h.cookies).toEqual(["new-token"]);
  });
});

describe("regenerateCodesAction", () => {
  it("returns the new codes for a verified staff session", async () => {
    h.session = staff(true, "admin");
    h.regenerate.mockResolvedValueOnce({ ok: true, recoveryCodes: ["n1"] });
    expect(await actions.regenerateCodesAction("123456")).toEqual({
      ok: true,
      recoveryCodes: ["n1"],
    });
    h.regenerate.mockResolvedValueOnce({ ok: false, reason: "locked" });
    expect(await actions.regenerateCodesAction("123456")).toEqual({ ok: false, reason: "locked" });
  });

  it("removePasskeyAction refuses an id that is not a uuid", async () => {
    h.session = staff(true);
    expect(await actions.removePasskeyAction("../etc")).toEqual({ ok: false, reason: "error" });
    expect(h.removed).toEqual([]);
  });
});
