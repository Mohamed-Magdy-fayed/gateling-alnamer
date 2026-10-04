import { ar, type Dictionary } from "@/i18n/ar";
import { dirOf, format, type Locale } from "@/i18n/config";
import { en } from "@/i18n/en";
import { escapeHtml } from "@/server/email-html";

const dictionaries: Record<Locale, Dictionary> = { ar, en };

export type SupportEmailInput = { name: string; publicNumber: string | null };
export type RenderedSupportMail = { subject: string; text: string; html: string };

const MAX_NAME_LENGTH = 80;

/** A student-chosen name goes into a mail body: one line, at most 80 characters. */
export function supportStudentName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/** The device-support request mail: the student's name and public number only, never their email. */
export function renderSupportEmail(locale: Locale, input: SupportEmailInput): RenderedSupportMail {
  const t = dictionaries[locale];
  const copy = t.email.deviceSupport;
  const body = format(copy.body, { name: supportStudentName(input.name) });
  const number = input.publicNumber ? `${copy.numberLabel} ${input.publicNumber}` : null;

  const text = [body, number, copy.footer]
    .filter((line): line is string => line !== null)
    .join("\n\n");

  const html =
    `<div dir="${dirOf(locale)}" style="font-family:sans-serif;line-height:1.6">` +
    `<p>${escapeHtml(body)}</p>` +
    (input.publicNumber
      ? `<p>${escapeHtml(copy.numberLabel)} <bdi dir="ltr">${escapeHtml(input.publicNumber)}</bdi></p>`
      : "") +
    `<p style="color:#666">${escapeHtml(copy.footer)}</p>` +
    `</div>`;

  return { subject: copy.subject, text, html };
}
