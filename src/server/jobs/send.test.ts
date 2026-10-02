import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const sendMailMock = vi.fn();
vi.mock("./client", () => ({ inngest: { send: sendMock, createFunction: vi.fn() } }));
vi.mock("@/server/email", () => ({ sendMail: sendMailMock }));

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
    expect(sendMock).toHaveBeenCalledWith({ name: "email/send", data: mail });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
