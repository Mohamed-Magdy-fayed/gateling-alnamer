import { ar, type Dictionary } from "@/i18n/ar";
import { dirOf, format, type Locale } from "@/i18n/config";
import { en } from "@/i18n/en";
import type { CodePurpose } from "./codes";

const dictionaries: Record<Locale, Dictionary> = { ar, en };

export type CodeEmailInput = { name: string; code: string; purpose: CodePurpose };
export type RenderedMail = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Renders the code email in the recipient's locale: HTML (code in an LTR island) plus plain text. */
export function renderCodeEmail(locale: Locale, input: CodeEmailInput): RenderedMail {
  const t = dictionaries[locale];
  const isReset = input.purpose === "password_reset";
  const subject = isReset ? t.email.code.subjectReset : t.email.code.subjectVerify;
  const lead = isReset ? t.email.code.bodyReset : t.email.code.bodyVerify;
  const greeting = format(t.email.code.greeting, { name: input.name });

  const text = [greeting, `${lead} ${input.code}`, t.email.code.expiry, t.email.code.footer].join(
    "\n\n",
  );

  const html =
    `<div dir="${dirOf(locale)}" style="font-family:sans-serif;line-height:1.6">` +
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>${escapeHtml(lead)}</p>` +
    `<p><span dir="ltr" style="display:inline-block;font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(input.code)}</span></p>` +
    `<p>${escapeHtml(t.email.code.expiry)}</p>` +
    `<p style="color:#666">${escapeHtml(t.email.code.footer)}</p>` +
    `</div>`;

  return { subject, text, html };
}
