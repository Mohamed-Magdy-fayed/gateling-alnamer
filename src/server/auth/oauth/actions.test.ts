import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";

const h = vi.hoisted(() => ({
  pending: null as null | { id: string; identity: unknown; next: string },
  result: { ok: true, userId: "u-new" } as unknown,
  completeArgs: [] as unknown[][],
  signedIn: [] as unknown[][],
  cleared: 0,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/i18n/server", () => ({ getDictionary: async () => ({ t: en, locale: "en" }) }));
vi.mock("../request-context", () => ({ requestContext: async () => ({ ip: "203.0.113.4" }) }));
vi.mock("./cookies", () => ({
  readPendingCookie: async () => h.pending,
  clearPendingCookie: async () => {
    h.cleared += 1;
  },
}));
vi.mock("./decide", () => ({
  completeGoogleSignUp: async (...args: unknown[]) => {
    h.completeArgs.push(args);
    return h.result;
  },
}));
vi.mock("../complete-sign-in", () => ({
  completeSignIn: async (...args: unknown[]) => {
    h.signedIn.push(args);
    throw new Error("redirect:signed-in");
  },
}));

const { completeGoogleAction } = await import("./actions");

const identity = { subject: "s1", email: "g@example.test", emailVerified: true, name: "G" };
const submit = () => {
  const data = new FormData();
  data.set("name", "Google Student");
  data.set("role", "student");
  data.set("date_of_birth", "2012-01-01");
  data.set("guardian_consent", "on");
  return completeGoogleAction({ status: "idle" }, data);
};

beforeEach(() => {
  h.pending = { id: "p1", identity, next: "/courses" };
  h.result = { ok: true, userId: "u-new" };
  h.completeArgs.length = 0;
  h.signedIn.length = 0;
  h.cleared = 0;
});

describe("completeGoogleAction", () => {
  it("without a live pending sign-up goes back to sign in", async () => {
    h.pending = null;
    await expect(submit()).rejects.toThrow("redirect:/sign-in?notice=google-failed");
    expect(h.completeArgs).toHaveLength(0);
  });

  it("creates the account with the pending row id, clears the cookie and signs in to next", async () => {
    await expect(submit()).rejects.toThrow("redirect:signed-in");
    expect(h.completeArgs[0]?.[2]).toMatchObject({ pendingId: "p1", locale: "en" });
    expect(h.cleared).toBe(1);
    expect(h.signedIn).toEqual([["u-new", { ip: "203.0.113.4" }, "/courses"]]);
  });

  it("an email taken meanwhile that links signs that user in (the signin branch)", async () => {
    h.result = { ok: false, decision: { kind: "signin", userId: "u-existing" } };
    await expect(submit()).rejects.toThrow("redirect:signed-in");
    expect(h.cleared).toBe(1);
    expect(h.signedIn).toEqual([["u-existing", { ip: "203.0.113.4" }, "/courses"]]);
  });

  it("a spent or refused pending sign-up never signs in", async () => {
    h.result = { ok: false, decision: { kind: "refused" } };
    await expect(submit()).rejects.toThrow("redirect:/sign-in?notice=google-failed");
    h.result = { ok: false, decision: { kind: "needs_password" } };
    await expect(submit()).rejects.toThrow("redirect:/sign-in?notice=google-password");
    expect(h.signedIn).toHaveLength(0);
  });

  it("field errors keep the pending cookie and echo the values", async () => {
    h.result = { ok: false, fields: ["name"] };
    const state = await submit();
    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { name: en.auth.errors.field.name },
      values: { name: "Google Student", role: "student" },
    });
    expect(h.cleared).toBe(0);
  });
});
