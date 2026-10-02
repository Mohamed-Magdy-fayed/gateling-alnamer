import { describe, expect, it } from "vitest";
import { ar } from "@/i18n/ar";
import { en } from "@/i18n/en";
import { renderCodeEmail } from "./email-templates";

const base = { name: "Sam", code: "123456", purpose: "password_reset" as const };

describe("renderCodeEmail", () => {
  it("renders English with the code in an LTR span and the expiry", () => {
    const mail = renderCodeEmail("en", base);
    expect(mail.subject).toBe(en.email.code.subjectReset);
    expect(mail.html).toContain('dir="ltr"');
    expect(mail.html).toContain('<span dir="ltr"');
    expect(mail.html).toContain("123456");
    expect(mail.text).toContain("123456");
    expect(mail.text).toContain("Sam");
    expect(mail.text).toContain("10");
    expect(mail.text).toContain(en.email.code.footer);
  });

  it("renders Arabic, right to left, with the Arabic subject", () => {
    const mail = renderCodeEmail("ar", { ...base, purpose: "email_verify" });
    expect(mail.subject).toBe(ar.email.code.subjectVerify);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('<span dir="ltr"');
    expect(mail.text).toContain(ar.email.code.footer);
  });

  it("escapes the name in the HTML but not in the plain text", () => {
    const mail = renderCodeEmail("en", { ...base, name: `<img src=x onerror="a()">&` });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&#60;img");
    expect(mail.text).toContain("<img");
  });
});
