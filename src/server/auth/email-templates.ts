import { ar, type Dictionary } from "@/i18n/ar";
import { dirOf, format, type Locale } from "@/i18n/config";
import { en } from "@/i18n/en";
import { escapeHtml } from "@/server/email-html";
import type { CodePurpose } from "./codes";

const dictionaries: Record<Locale, Dictionary> = { ar, en };

export type CodeEmailInput = {
  name: string;
  code: string;
  purpose: CodePurpose;
  /** A self-serve reset: opens the reset screen on any device (the mailbox is the capability). */
  link?: string;
};
export type RenderedMail = { subject: string; text: string; html: string };

/** Renders the code email in the recipient's locale: HTML (code in an LTR island) plus plain text. */
export function renderCodeEmail(locale: Locale, input: CodeEmailInput): RenderedMail {
  const t = dictionaries[locale];
  const isReset = input.purpose === "password_reset";
  const subject = isReset ? t.email.code.subjectReset : t.email.code.subjectVerify;
  const lead = isReset ? t.email.code.bodyReset : t.email.code.bodyVerify;
  const greeting = format(t.email.code.greeting, { name: input.name });

  const linkLines = isReset && input.link ? [`${t.email.code.resetLink}\n${input.link}`] : [];
  const text = [
    greeting,
    `${lead} ${input.code}`,
    ...linkLines,
    t.email.code.expiry,
    t.email.code.footer,
  ].join("\n\n");
  const linkHtml =
    isReset && input.link
      ? `<p>${escapeHtml(t.email.code.resetLink)}<br><a dir="ltr" href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`
      : "";

  const html =
    `<div dir="${dirOf(locale)}" style="font-family:sans-serif;line-height:1.6">` +
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>${escapeHtml(lead)}</p>` +
    `<p><span dir="ltr" style="display:inline-block;font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(input.code)}</span></p>` +
    linkHtml +
    `<p>${escapeHtml(t.email.code.expiry)}</p>` +
    `<p style="color:#666">${escapeHtml(t.email.code.footer)}</p>` +
    `</div>`;

  return { subject, text, html };
}
