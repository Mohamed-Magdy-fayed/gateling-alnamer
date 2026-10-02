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

describe("handleSendCodeEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the rendered mail in the recipient's locale and marks it sent", async () => {
    const { handleSendCodeEmail } = await import("./send-code-email");
    await handleSendCodeEmail(data);
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
    const { handleSendCodeEmail } = await import("./send-code-email");
    await expect(handleSendCodeEmail(data)).rejects.toThrow("smtp down");
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
