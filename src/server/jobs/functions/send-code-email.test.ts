import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sendMail: vi.fn(async (_mail: unknown) => undefined),
  sent: vi.fn(async (_id: string) => undefined),
  failed: vi.fn(async (_id: string) => undefined),
}));
vi.mock("@/server/email", () => ({ sendMail: h.sendMail }));
vi.mock("@/server/auth/codes", () => ({
  markCodeEmailSent: h.sent,
  markCodeEmailFailed: h.failed,
}));
vi.mock("../client", () => ({ inngest: { createFunction: vi.fn() } }));

const data = {
  codeId: "c1",
  to: "sam@example.test",
  locale: "ar" as const,
  purpose: "email_verify" as const,
  code: "654321",
  name: "Sam",
};

const passThrough = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
};

describe("runCodeEmailSteps (rendering and failures)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the rendered mail in the recipient's locale and marks it sent", async () => {
    const { runCodeEmailSteps } = await import("./send-code-email");
    await runCodeEmailSteps(data, passThrough);
    const mail = h.sendMail.mock.calls[0]?.[0] as { to: string; subject: string; html: string };
    const { ar } = await import("@/i18n/ar");
    expect(mail.to).toBe("sam@example.test");
    expect(mail.subject).toBe(ar.email.code.subjectVerify);
    expect(mail.html).toContain("654321");
    expect(h.sent).toHaveBeenCalledWith("c1");
    expect(h.failed).not.toHaveBeenCalled();
  });

  it("throws on a send error without marking sent", async () => {
    h.sendMail.mockRejectedValueOnce(new Error("smtp down"));
    const { runCodeEmailSteps } = await import("./send-code-email");
    await expect(runCodeEmailSteps(data, passThrough)).rejects.toThrow("smtp down");
    expect(h.sent).not.toHaveBeenCalled();
  });
});

describe("runCodeEmailInline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records failed without throwing, and never logs the code or address", async () => {
    h.sendMail.mockRejectedValueOnce(new Error("smtp down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runCodeEmailInline } = await import("./send-code-email");
    await expect(runCodeEmailInline(data)).resolves.toBeUndefined();
    expect(h.failed).toHaveBeenCalledWith("c1");
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("654321");
    expect(logged).not.toContain("sam@example.test");
    spy.mockRestore();
  });

  it("marks sent on success", async () => {
    const { runCodeEmailInline } = await import("./send-code-email");
    await runCodeEmailInline(data);
    expect(h.sent).toHaveBeenCalledWith("c1");
  });
});

describe("failure handler", () => {
  it("marks the code failed", async () => {
    vi.clearAllMocks();
    const { markCodeEmailFailedFromEvent } = await import("./send-code-email");
    await markCodeEmailFailedFromEvent({ encrypted: data });
    expect(h.failed).toHaveBeenCalledWith("c1");
  });
});

/** Inngest memoizes a step that returned; a retry re-runs only the steps that did not. */
function memoizingStep() {
  const done = new Map<string, unknown>();
  const ran: string[] = [];
  return {
    ran,
    run: async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
      if (done.has(id)) return done.get(id) as T;
      ran.push(id);
      const value = await fn();
      done.set(id, value);
      return value;
    },
  };
}

describe("runCodeEmailSteps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends in one step and marks sent in another", async () => {
    const { runCodeEmailSteps } = await import("./send-code-email");
    const step = memoizingStep();
    await runCodeEmailSteps(data, step);
    expect(step.ran).toEqual(["send", "mark-sent"]);
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveBeenCalledWith("c1");
  });

  it("never re-sends when marking fails after a successful send", async () => {
    const { runCodeEmailSteps } = await import("./send-code-email");
    const step = memoizingStep();
    h.sent.mockRejectedValueOnce(new Error("db blip"));
    await expect(runCodeEmailSteps(data, step)).rejects.toThrow("db blip");
    await runCodeEmailSteps(data, step);
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveBeenCalledTimes(2);
  });

  it("does not mark sent when the send step fails", async () => {
    const { runCodeEmailSteps } = await import("./send-code-email");
    h.sendMail.mockRejectedValueOnce(new Error("smtp down"));
    await expect(runCodeEmailSteps(data, memoizingStep())).rejects.toThrow("smtp down");
    expect(h.sent).not.toHaveBeenCalled();
  });
});

describe("runCodeEmailInline after a successful send", () => {
  it("does not record failed when only the mark step fails", async () => {
    vi.clearAllMocks();
    h.sent.mockRejectedValueOnce(new Error("db blip"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runCodeEmailInline } = await import("./send-code-email");
    await expect(runCodeEmailInline(data)).resolves.toBeUndefined();
    expect(h.failed).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
