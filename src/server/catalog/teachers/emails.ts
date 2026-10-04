import "server-only";
import type { Dictionary } from "@/i18n/ar";
import { dirOf, format, isLocale, type Locale } from "@/i18n/config";
import { emailDictionaries, escapeHtml, type RenderedMail } from "@/server/email-html";
import { sendEvent } from "@/server/jobs/send";

// Teacher onboarding emails (C1): application received, approved, rejected (with the reason) and
// the invitation link. Rendered in the recipient's locale; queued through `email/send`.

export type TeacherEmail =
  | { kind: "applied"; name: string }
  | { kind: "approved"; name: string }
  | { kind: "rejected"; name: string; reason: string }
  | { kind: "invite"; name: string; link: string };

function copyOf(locale: Locale, mail: TeacherEmail): { subject: string; body: string } {
  const t: Dictionary = emailDictionaries[locale];
  const c = t.email.teacher;
  const vars = { name: mail.name };
  switch (mail.kind) {
    case "applied":
      return { subject: c.appliedSubject, body: format(c.appliedBody, vars) };
    case "approved":
      return { subject: c.approvedSubject, body: format(c.approvedBody, vars) };
    case "rejected":
      return { subject: c.rejectedSubject, body: format(c.rejectedBody, vars) };
    case "invite":
      return { subject: c.inviteSubject, body: format(c.inviteBody, vars) };
  }
}

export function renderTeacherEmail(locale: Locale, mail: TeacherEmail): RenderedMail {
  const t: Dictionary = emailDictionaries[locale];
  const c = t.email.teacher;
  const { subject, body } = copyOf(locale, mail);
  const extraText =
    mail.kind === "rejected"
      ? [`${c.reasonLabel} ${mail.reason}`]
      : mail.kind === "invite"
        ? [mail.link]
        : [];
  const extraHtml =
    mail.kind === "rejected"
      ? `<p>${escapeHtml(c.reasonLabel)} ${escapeHtml(mail.reason)}</p>`
      : mail.kind === "invite"
        ? `<p><a dir="ltr" href="${escapeHtml(mail.link)}">${escapeHtml(mail.link)}</a></p>`
        : "";
  const text = [body, ...extraText, c.footer].join("\n\n");
  const html =
    `<div dir="${dirOf(locale)}" style="font-family:sans-serif;line-height:1.6">` +
    `<p>${escapeHtml(body)}</p>${extraHtml}` +
    `<p style="color:#666">${escapeHtml(c.footer)}</p></div>`;
  return { subject, text, html };
}

/**
 * Queues the email; a failure is logged by name only and never changes the caller's answer (the
 * decision or account is already saved).
 */
export async function sendTeacherEmail(
  to: string | null,
  savedLocale: string | null,
  fallback: Locale,
  mail: TeacherEmail,
): Promise<void> {
  if (!to) return;
  const locale = isLocale(savedLocale ?? undefined) ? (savedLocale as Locale) : fallback;
  try {
    await sendEvent("email/send", { to, ...renderTeacherEmail(locale, mail) });
  } catch (error: unknown) {
    console.error("Teacher email failed", error instanceof Error ? error.name : "unknown");
  }
}
