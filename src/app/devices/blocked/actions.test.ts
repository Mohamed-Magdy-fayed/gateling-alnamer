import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { setClockForTests } from "@/server/clock";

const h = vi.hoisted(() => ({
  pre: null as null | { userId: string; deviceKey: string; tokenHash: string },
  requestKey: "key-1",
  guard: { ok: true } as { ok: true } | { blocked: "rateLimited" },
  guardCalls: [] as unknown[],
  sendCalls: [] as unknown[][],
  sendError: null as null | Error,
  registered: { ok: true, deviceId: "dev-new" } as
    | { ok: true; deviceId: string }
    | { ok: false; reason: string; nextAt?: Date },
  removeCalls: [] as unknown[],
  created: [] as unknown[][],
  cleared: 0,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({ t: en, locale: "en" as const }),
}));
vi.mock("@/server/auth/request-context", () => ({
  requestContext: async () => ({
    ip: "203.0.113.5",
    deviceId: h.requestKey,
    deviceKey: h.requestKey,
    userAgent: "UA",
    secure: false,
  }),
}));
vi.mock("@/server/auth/abuse", () => ({
  guardSupportRequest: async (...args: unknown[]) => {
    h.guardCalls.push(args);
    return h.guard;
  },
}));
vi.mock("@/server/auth/session", () => ({
  createSession: async (...args: unknown[]) => {
    h.created.push(args);
  },
}));
vi.mock("@/server/devices/pre-session", () => ({
  getPreSession: async () => h.pre,
  clearPreSession: async () => {
    h.cleared += 1;
  },
}));
vi.mock("@/server/devices/service", () => ({
  removeAndRegister: async (input: unknown) => {
    h.removeCalls.push(input);
    return h.registered;
  },
}));
vi.mock("@/server/jobs/send", () => ({
  sendEvent: async (...args: unknown[]) => {
    h.sendCalls.push(args);
    if (h.sendError) throw h.sendError;
  },
}));

const { contactSupportAction, removeDeviceAction } = await import("./actions");

const DEVICE_ID = "5b5d1c6e-4b5a-4a6e-8a55-7f0a6f9c1a11";
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
};
const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message;
    throw error;
  }
};

beforeEach(() => {
  setClockForTests(new Date("2030-03-01T22:30:00.000Z")); // Cairo: 2 March
  h.pre = { userId: "u1", deviceKey: "key-1", tokenHash: "t" };
  h.requestKey = "key-1";
  h.guard = { ok: true };
  h.guardCalls.length = 0;
  h.sendCalls.length = 0;
  h.sendError = null;
  h.registered = { ok: true, deviceId: "dev-new" };
  h.removeCalls.length = 0;
  h.created.length = 0;
  h.cleared = 0;
});

describe("contactSupportAction", () => {
  it("checks the per-IP and global caps with the request's IP", async () => {
    await contactSupportAction();
    expect(h.guardCalls).toEqual([[{ userId: "u1", ip: "203.0.113.5" }]]);
  });

  it("enqueues once per student per Cairo day through the event id", async () => {
    const state = await contactSupportAction();
    expect(state).toMatchObject({ status: "success", message: en.devices.supportSent });
    expect(h.sendCalls).toEqual([
      [
        "devices/support-request",
        { userId: "u1", locale: "en" },
        { id: "devices-support:u1:2030-03-02" },
      ],
    ]);
  });

  it("answers a failed enqueue with an error, never a false 'sent'", async () => {
    h.sendError = new Error("inngest down");
    const state = await contactSupportAction();
    expect(state).toMatchObject({ status: "error", message: en.devices.supportFailed });
  });

  it("answers a cap with the rate-limit message and enqueues nothing", async () => {
    h.guard = { blocked: "rateLimited" };
    const state = await contactSupportAction();
    expect(state).toMatchObject({ status: "error", message: en.auth.states.rateLimited });
    expect(h.sendCalls).toHaveLength(0);
  });

  it("needs a pre-session", async () => {
    h.pre = null;
    expect(await run(contactSupportAction)).toBe("redirect:/sign-in");
  });
});

describe("removeDeviceAction", () => {
  const remove = () => removeDeviceAction({ status: "idle" }, form({ deviceId: DEVICE_ID }));

  it("removes and registers in one service call for the pre-session's own device", async () => {
    expect(await run(remove)).toBe("redirect:/dashboard");
    expect(h.removeCalls).toEqual([
      {
        userId: "u1",
        deviceId: DEVICE_ID,
        currentDeviceKey: "key-1",
        userAgent: "UA",
        preSessionTokenHash: "t",
      },
    ]);
    expect(h.created).toEqual([["u1", { deviceId: "dev-new" }]]);
    expect(h.cleared).toBe(1);
  });

  it("re-issues the flow when this browser's did is not the pre-session's device", async () => {
    h.requestKey = "someone-else";
    expect(await run(remove)).toBe("redirect:/sign-in");
    expect(h.removeCalls).toHaveLength(0);
    expect(h.created).toHaveLength(0);
  });

  it("returns the throttle message and creates no session", async () => {
    h.registered = { ok: false, reason: "throttled", nextAt: new Date("2030-03-09T10:00:00.000Z") };
    const state = await remove();
    expect(state).toMatchObject({ status: "error", tone: "warning" });
    expect(h.created).toHaveLength(0);
    expect(h.cleared).toBe(0);
  });

  it("sends a dead pre-session (reset, sign-out everywhere, suspension) to sign-in with no session", async () => {
    h.registered = { ok: false, reason: "expired" };
    expect(await run(remove)).toBe("redirect:/sign-in");
    expect(h.created).toHaveLength(0);
    expect(h.cleared).toBe(0);
  });

  it("goes back to the block screen when registration would still block", async () => {
    h.registered = { ok: false, reason: "blocked" };
    expect(await run(remove)).toBe("redirect:/devices/blocked");
    expect(h.created).toHaveLength(0);
  });
});
