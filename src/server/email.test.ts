import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
vi.mock("nodemailer", () => ({ default: { createTransport: createTransportMock } }));

type FakeEnv = {
  APP_MODE: "demo" | "live";
  SMTP_HOST?: string;
  SMTP_FROM_EMAIL?: string;
  providers: { email: "smtp" | "mailpit"; emailIsDefault: boolean };
};

let env: FakeEnv;
let deployed = false;
vi.mock("@/server/env", () => ({
  serverEnv: () => env,
  isDeployed: () => deployed,
}));

const mail = { to: "a@b.test", subject: "Hi", text: "body", html: "<p>body</p>" };

describe("sendMail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deployed = false;
    env = { APP_MODE: "demo", providers: { email: "smtp", emailIsDefault: false } };
  });

  it("logs to the console when smtp has no sender in demo outside Vercel", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { sendMail } = await import("./email");
    await expect(sendMail(mail)).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledOnce();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("logs to the console when the transport is unset and no sender is configured", async () => {
    env = { APP_MODE: "demo", providers: { email: "smtp", emailIsDefault: true } };
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { sendMail } = await import("./email");
    await expect(sendMail(mail)).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledOnce();
  });

  it("still throws on Vercel when smtp has no sender", async () => {
    deployed = true;
    const { sendMail } = await import("./email");
    await expect(sendMail(mail)).rejects.toThrow(/SMTP_FROM_EMAIL/);
  });

  it("still throws in live when smtp has no sender", async () => {
    env = { APP_MODE: "live", providers: { email: "smtp", emailIsDefault: false } };
    const { sendMail } = await import("./email");
    await expect(sendMail(mail)).rejects.toThrow(/SMTP_FROM_EMAIL/);
  });

  it("sends through smtp when fully configured", async () => {
    env = {
      APP_MODE: "demo",
      SMTP_HOST: "smtp.example",
      SMTP_FROM_EMAIL: "from@example.test",
      providers: { email: "smtp", emailIsDefault: false },
    };
    const { sendMail } = await import("./email");
    await sendMail(mail);
    expect(sendMailMock).toHaveBeenCalledOnce();
  });
});
