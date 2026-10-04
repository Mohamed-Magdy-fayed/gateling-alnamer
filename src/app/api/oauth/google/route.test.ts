import { beforeEach, describe, expect, it, vi } from "vitest";

type Decision =
  | { kind: "signin"; userId: string }
  | { kind: "new" }
  | { kind: "needs_password" }
  | { kind: "refused" };

const h = vi.hoisted(() => ({
  providerId: "google" as "google" | "mock" | null,
  guardOk: true,
  flow: null as null | { state: string; verifier: string; next: string },
  identity: { subject: "s1", email: "g@example.test", emailVerified: true, name: "G" } as unknown,
  exchangeArgs: [] as unknown[],
  decision: { kind: "refused" } as Decision,
  signedIn: [] as unknown[],
  pending: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/server/auth/abuse", () => ({
  guardOAuthCallback: async () => (h.guardOk ? { ok: true } : { blocked: "locked" }),
}));
vi.mock("@/server/auth/request-context", () => ({
  requestContext: async () => ({ ip: "203.0.113.9", deviceId: null, secure: true }),
}));
vi.mock("@/server/auth/oauth/routes", () => ({
  currentProvider: () =>
    h.providerId
      ? {
          id: h.providerId,
          exchange: async (args: unknown) => {
            h.exchangeArgs.push(args);
            if (h.identity === null) throw new Error("exchange failed");
            return h.identity;
          },
        }
      : null,
  redirectUriFor: () => "https://alnamer.example/api/oauth/google",
}));
vi.mock("@/server/auth/oauth/cookies", () => ({
  takeFlowCookie: async () => h.flow,
  setPendingCookie: async (...args: unknown[]) => {
    h.pending.push(args);
  },
}));
vi.mock("@/server/auth/oauth/decide", () => ({ resolveOAuthSignIn: async () => h.decision }));
vi.mock("@/server/auth/complete-sign-in", () => ({
  completeSignIn: async (...args: unknown[]) => {
    h.signedIn.push(args);
    throw new Error("redirect:signed-in");
  },
}));

const { GET } = await import("./route");

const call = (query: string, host = "alnamer.example") =>
  GET({
    nextUrl: new URL(`https://${host}/api/oauth/google?${query}`),
  } as never);

beforeEach(() => {
  h.providerId = "google";
  h.guardOk = true;
  h.flow = { state: "state-1", verifier: "v1", next: "/dashboard" };
  h.identity = { subject: "s1", email: "g@example.test", emailVerified: true, name: "G" };
  h.exchangeArgs.length = 0;
  h.decision = { kind: "refused" };
  h.signedIn.length = 0;
  h.pending.length = 0;
});

const FAILED = "redirect:/sign-in?notice=google-failed";

describe("GET /api/oauth/google", () => {
  it("refuses a missing flow, a wrong state, a missing code or an oversized parameter", async () => {
    await expect(call("state=state-x&code=c")).rejects.toThrow(FAILED);
    await expect(call("state=state-1")).rejects.toThrow(FAILED);
    await expect(call(`state=state-1&code=${"c".repeat(2049)}`)).rejects.toThrow(FAILED);
    h.flow = null;
    await expect(call("state=state-1&code=c")).rejects.toThrow(FAILED);
    expect(h.exchangeArgs).toHaveLength(0);
  });

  it("is rate limited before the flow cookie is read", async () => {
    h.guardOk = false;
    await expect(call("state=state-1&code=c")).rejects.toThrow(FAILED);
    expect(h.exchangeArgs).toHaveLength(0);
  });

  it("the mock provider answers only on a local host", async () => {
    h.providerId = "mock";
    await expect(call("state=state-1&code=c")).rejects.toThrow(FAILED);
    expect(h.exchangeArgs).toHaveLength(0);
  });

  it("exchanges with the PKCE verifier, then signs a known identity in to flow.next", async () => {
    h.decision = { kind: "signin", userId: "u1" };
    await expect(call("state=state-1&code=c")).rejects.toThrow("redirect:signed-in");
    expect(h.exchangeArgs).toEqual([
      { code: "c", codeVerifier: "v1", redirectUri: "https://alnamer.example/api/oauth/google" },
    ]);
    expect(h.signedIn).toEqual([
      ["u1", expect.objectContaining({ ip: "203.0.113.9" }), "/dashboard"],
    ]);
  });

  it("a new identity gets the pending cookie and the completion page", async () => {
    h.decision = { kind: "new" };
    await expect(call("state=state-1&code=c")).rejects.toThrow("redirect:/sign-up/google");
    expect(h.pending).toEqual([[h.identity, "/dashboard"]]);
    expect(h.signedIn).toHaveLength(0);
  });

  it("needs_password and refused land on their notices; a failed exchange too", async () => {
    h.decision = { kind: "needs_password" };
    await expect(call("state=state-1&code=c")).rejects.toThrow(
      "redirect:/sign-in?notice=google-password",
    );
    h.decision = { kind: "refused" };
    await expect(call("state=state-1&code=c")).rejects.toThrow(FAILED);
    h.identity = null;
    await expect(call("state=state-1&code=c")).rejects.toThrow(FAILED);
    expect(h.signedIn).toHaveLength(0);
  });
});
