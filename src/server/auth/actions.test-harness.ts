import { type Mock, vi } from "vitest";
import { en } from "@/i18n/en";
import { setClockForTests } from "@/server/clock";

// The shared fake world of the auth server-action tests (actions.test.ts, actions.codes.test.ts).
// Each test file points its vi.mock factories at `mocks` (async import, so the factories see this
// one module instance) and resets the state with `resetHarness` before every test.

export const h = {
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
  sessionUser: null as null | { id: string; email: string | null; role?: string },
  sessionVerified: false,
  pending: null as null | { email: string; issuedAt: number; nonce: string },
  pendingSet: [] as string[],
  pendingNonces: [] as string[],
  nonces: 0,
  pendingCleared: 0,
  codeRow: null as null | { emailStatus: "queued" | "sent" | "failed"; createdAt: Date },
  contexts: 0,
  known: new Set<string>(),
  seen: [] as string[],
};

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

export const mocks = {
  nextServer: () => ({
    after: (task: () => Promise<void> | void) => {
      h.after.push(task);
    },
  }),
  navigation: () => ({
    redirect: (to: string) => {
      throw new Error(`redirect:${to}`);
    },
  }),
  i18n: () => ({ getDictionary: async () => ({ t: en, locale: "en" as const }) }),
  rateLimit: async () => {
    const { MemoryLimiter } = await import("../../../test/fake-limiter");
    h.memory = new MemoryLimiter();
    return { createRateLimiter: () => h.memory };
  },
  // Same rule as the fake provider: any non-empty token passes except "fail".
  captcha: () => ({
    verifyCaptcha: async (token: string | undefined) => Boolean(token?.trim()) && token !== "fail",
  }),
  signUp: (actual: typeof import("./sign-up")) => {
    h.signUp = vi.fn(actual.signUpUser);
    return {
      ...actual,
      signUpUser: (...args: Parameters<typeof actual.signUpUser>) => {
        if (!h.signUp) throw new Error("signUp spy missing");
        return h.signUp(...args);
      },
    };
  },
  knownDevice: () => ({
    isKnownDevice: async (id: string) => h.known.has(id),
    markDeviceSeen: async (id: string) => {
      h.seen.push(id);
    },
  }),
  sessionInvalidate: () => ({
    deleteUserSessionsIn: async () => {
      h.calls.push("sessions:delete");
      return ["hash-1"];
    },
    purgeSessionCache: async () => {
      h.calls.push("sessions:purge");
    },
  }),
  requestContext: () => ({
    requestContext: async () => {
      h.contexts += 1;
      return { ip: h.ip, deviceId: h.deviceId, deviceKey: "key-1", userAgent: "UA", secure: false };
    },
  }),
  deviceSignIn: () => ({
    gateDevice: async (...args: unknown[]) => {
      h.gateCalls.push(args);
      return h.gate;
    },
  }),
  cache: () => ({ revalidatePath: () => undefined }),
  pendingReset: () => ({
    newResetNonce: () => {
      h.nonces += 1;
      return `nonce-${h.nonces}`;
    },
    resetRequesterHash: (nonce: string) => `rh:${nonce}`,
    setPendingReset: async (email: string, nonce: string) => {
      h.pendingSet.push(email);
      h.pendingNonces.push(nonce);
    },
    readPendingReset: async () => h.pending,
    clearPendingReset: async () => {
      h.pendingCleared += 1;
    },
  }),
  codeStatus: () => ({ latestCodeRow: async () => h.codeRow }),
  db: () => ({
    db: () => ({
      query: { users: { findFirst: async () => h.user } },
      transaction: async (run: (executor: typeof tx) => Promise<unknown>) => {
        h.calls.push("tx:begin");
        const result = await run(tx);
        h.calls.push("tx:end");
        return result;
      },
    }),
  }),
  jobs: () => ({
    sendEvent: async (...args: unknown[]) => {
      if (h.sendError) throw h.sendError;
      h.sent.push(args);
    },
  }),
  codes: () => ({
    issueCode: h.issue,
    verifyCode: async (...args: Parameters<typeof h.verify>) => {
      h.calls.push(`verify:${args[0]}`);
      return h.verify(...args);
    },
    verifyCodeDecoy: h.verifyDecoy,
    markCodeEmailSent: async () => undefined,
    deleteCode: async () => undefined,
  }),
  session: () => ({
    getCurrentSession: async () =>
      h.sessionUser
        ? { user: { role: "student", ...h.sessionUser }, twoFactorVerified: h.sessionVerified }
        : null,
    createSession: async (userId: string, options?: { deviceId?: string | null }) => {
      h.calls.push(options?.deviceId ? `create:${userId}:${options.deviceId}` : `create:${userId}`);
    },
    destroySession: async () => {
      h.calls.push("destroy");
    },
    invalidateUserSessions: async () => undefined,
  }),
};

export const OK = { captcha_token: "fake-ok" };
/** Every time in these tests comes from the pinned clock, so no assertion races a minute or ms boundary. */
export const NOW = new Date("2030-03-01T09:00:00.000Z");
export const now = () => NOW.getTime();

/** Runs what the actions handed to `after()`, as Next does once the response is sent. */
export async function runAfter(): Promise<void> {
  const tasks = h.after.splice(0);
  for (const task of tasks) await task();
}

export function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

export function resetHarness(): void {
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
  h.sessionVerified = false;
  h.pending = null;
  h.pendingSet.length = 0;
  h.pendingNonces.length = 0;
  h.nonces = 0;
  h.pendingCleared = 0;
  h.codeRow = null;
  h.contexts = 0;
  h.known.clear();
  h.seen.length = 0;
  h.gate = { kind: "allowed", deviceId: null, overLimit: false };
  h.gateCalls.length = 0;
  vi.clearAllMocks();
}

/** Runs an action that may redirect; a redirect comes back as a value. */
export async function followRedirect<T extends { status: string }>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) {
      return { status: "redirected" as const, to: error.message.slice("redirect:".length) };
    }
    throw error;
  }
}
