import { describe, expect, it } from "vitest";
import { ar } from "@/i18n/ar";
import { en } from "@/i18n/en";
import { renderSupportEmail } from "./support-email";

const student = { name: "Sam <b>", publicNumber: "AN-1042" };

describe("renderSupportEmail", () => {
  it("renders Arabic with rtl, the subject and the student's name and public number", () => {
    const mail = renderSupportEmail("ar", student);
    expect(mail.subject).toBe(ar.email.deviceSupport.subject);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.text).toContain("AN-1042");
    expect(mail.text).toContain("Sam <b>");
  });

  it("renders English with ltr and escapes the name in HTML", () => {
    const mail = renderSupportEmail("en", student);
    expect(mail.subject).toBe(en.email.deviceSupport.subject);
    expect(mail.html).toContain('dir="ltr"');
    expect(mail.html).not.toContain("<b>");
    expect(mail.html).toContain('<bdi dir="ltr">AN-1042</bdi>');
  });

  it("copes with a missing public number", () => {
    const mail = renderSupportEmail("en", { name: "Sam", publicNumber: null });
    expect(mail.text).not.toContain("null");
  });
});
