import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEvent = vi.hoisted(() => vi.fn());
vi.mock("@/server/jobs/send", () => ({ sendEvent }));

const { renderTeacherEmail, sendTeacherEmail } = await import("./emails");

describe("renderTeacherEmail", () => {
  it("renders each kind in the recipient's locale and direction", () => {
    const applied = renderTeacherEmail("ar", { kind: "applied", name: "منى" });
    expect(applied.subject).toBe("استلمنا طلبك للتدريس - النمر");
    expect(applied.html).toContain('dir="rtl"');
    expect(applied.text).toContain("مرحبًا منى");
    const approved = renderTeacherEmail("en", { kind: "approved", name: "Mona" });
    expect(approved.subject).toBe("You can now teach on Al-Namer");
    expect(approved.html).toContain('dir="ltr"');
  });

  it("puts the rejection reason in both bodies, escaped in the HTML", () => {
    const mail = renderTeacherEmail("en", {
      kind: "rejected",
      name: "Sam",
      reason: "Missing <b>certificate</b>",
    });
    expect(mail.text).toContain("Reason: Missing <b>certificate</b>");
    expect(mail.html).toContain("Missing &#60;b&#62;certificate&#60;/b&#62;");
    expect(mail.html).not.toContain("<b>certificate");
  });

  it("puts the invite link as an LTR link", () => {
    const link = "https://alnamer.example/teach/invite/abc_DEF-123";
    const mail = renderTeacherEmail("ar", { kind: "invite", name: "Omar", link });
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`<a dir="ltr" href="${link}">`);
  });
});

describe("sendTeacherEmail", () => {
  beforeEach(() => {
    sendEvent.mockReset();
  });

  it("does nothing without an address", async () => {
    await sendTeacherEmail(null, "ar", "en", { kind: "approved", name: "Mona" });
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("uses the saved locale, or the fallback when it is missing or unknown", async () => {
    await sendTeacherEmail("a@example.com", "en", "ar", { kind: "approved", name: "Mona" });
    await sendTeacherEmail("b@example.com", "xx", "ar", { kind: "approved", name: "Mona" });
    await sendTeacherEmail("c@example.com", null, "en", { kind: "approved", name: "Mona" });
    const subjects = sendEvent.mock.calls.map(([, payload]) => payload.subject);
    expect(subjects).toEqual([
      "You can now teach on Al-Namer",
      renderTeacherEmail("ar", { kind: "approved", name: "Mona" }).subject,
      "You can now teach on Al-Namer",
    ]);
    expect(sendEvent.mock.calls[0]?.[0]).toBe("email/send");
    expect(sendEvent.mock.calls[0]?.[1]).toMatchObject({ to: "a@example.com" });
  });

  it("swallows a queue failure (the decision is already saved) and logs only its name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sendEvent.mockRejectedValueOnce(new TypeError("queue down for a@example.com"));
    await expect(
      sendTeacherEmail("a@example.com", "en", "en", { kind: "approved", name: "Mona" }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("Teacher email failed", "TypeError");
    log.mockRestore();
  });
});
