import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/jobs/send", () => ({ sendEvent: vi.fn() }));

const { renderTeacherEmail } = await import("./emails");

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
