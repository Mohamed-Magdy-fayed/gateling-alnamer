import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sendMail: vi.fn(async (_mail: unknown) => undefined),
  contacts: vi.fn(),
  student: vi.fn(),
}));
vi.mock("@/server/email", () => ({ sendMail: h.sendMail }));
vi.mock("@/server/devices/service", () => ({
  supportContacts: h.contacts,
  supportStudent: h.student,
}));
vi.mock("../client", () => ({ inngest: { createFunction: vi.fn() } }));

describe("handleSupportRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.student.mockResolvedValue({ name: "Sam", publicNumber: "AN-7" });
  });

  it("mails every contact in their own locale, falling back to the request locale", async () => {
    h.contacts.mockResolvedValue([
      { email: "a@example.test", locale: "en" },
      { email: "b@example.test", locale: null },
    ]);
    const { handleSupportRequest } = await import("./support-request");
    await handleSupportRequest({ userId: "u1", locale: "ar" });
    const { ar } = await import("@/i18n/ar");
    const { en } = await import("@/i18n/en");
    const sent = h.sendMail.mock.calls.map((c) => c[0] as { to: string; subject: string });
    expect(sent).toHaveLength(2);
    expect(sent.find((m) => m.to === "a@example.test")?.subject).toBe(
      en.email.deviceSupport.subject,
    );
    expect(sent.find((m) => m.to === "b@example.test")?.subject).toBe(
      ar.email.deviceSupport.subject,
    );
  });

  it("sends nothing when there are no contacts or the student is gone", async () => {
    h.contacts.mockResolvedValue([]);
    const { handleSupportRequest } = await import("./support-request");
    await handleSupportRequest({ userId: "u1", locale: "en" });
    h.contacts.mockResolvedValue([{ email: "a@example.test", locale: "en" }]);
    h.student.mockResolvedValue(null);
    await handleSupportRequest({ userId: "u1", locale: "en" });
    expect(h.sendMail).not.toHaveBeenCalled();
  });
});
