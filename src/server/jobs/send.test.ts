import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const sendMailMock = vi.fn();
vi.mock("./client", () => ({ inngest: { send: sendMock, createFunction: vi.fn() } }));
vi.mock("@/server/email", () => ({ sendMail: sendMailMock }));
const markSentMock = vi.fn();
const markFailedMock = vi.fn();
vi.mock("@/server/auth/codes", () => ({
  markCodeEmailSent: markSentMock,
  markCodeEmailFailed: markFailedMock,
}));

let jobs: "inline" | "inngest-dev" | "inngest" = "inline";
vi.mock("@/server/env", () => ({ serverEnv: () => ({ providers: { jobs } }) }));

const mail = { to: "a@b.test", subject: "Hi", text: "body", html: "<p>body</p>" };

describe("sendEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobs = "inline";
  });

  it("runs the matching handler in-process when inline", async () => {
    const { sendEvent } = await import("./send");
    await sendEvent("email/send", mail);
    expect(sendMailMock).toHaveBeenCalledWith(mail);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("propagates the handler error when inline", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    const { sendEvent } = await import("./send");
    await expect(sendEvent("email/send", mail)).rejects.toThrow("smtp down");
  });

  it.each(["inngest-dev", "inngest"] as const)("calls inngest.send when %s", async (mode) => {
    jobs = mode;
    const { sendEvent } = await import("./send");
    await sendEvent("email/send", mail);
    expect(sendMock).toHaveBeenCalledWith({
      name: "email/send",
      data: { encrypted: mail },
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("runs auth/code-email inline, marking sent, and records a send failure as failed", async () => {
    const { sendEvent } = await import("./send");
    const data = {
      codeId: "c1",
      to: "a@b.test",
      locale: "en" as const,
      purpose: "password_reset" as const,
      code: "123456",
      name: "A",
    };
    await sendEvent("auth/code-email", data);
    expect(markSentMock).toHaveBeenCalledWith("c1");
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendEvent("auth/code-email", data)).resolves.toBeUndefined();
    expect(markFailedMock).toHaveBeenCalledWith("c1");
  });

  it("wraps auth/code-email under encrypted when queued", async () => {
    jobs = "inngest";
    const { sendEvent } = await import("./send");
    const data = {
      codeId: "c1",
      to: "a@b.test",
      locale: "ar" as const,
      purpose: "email_verify" as const,
      code: "123456",
      name: "A",
    };
    await sendEvent("auth/code-email", data);
    expect(sendMock).toHaveBeenCalledWith({ name: "auth/code-email", data: { encrypted: data } });
  });
});
