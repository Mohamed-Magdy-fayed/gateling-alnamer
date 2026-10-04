import { ar, type Dictionary } from "@/i18n/ar";
import type { Locale } from "@/i18n/config";
import { en } from "@/i18n/en";

// Shared by the email templates: the dictionaries by locale and HTML escaping.

export const emailDictionaries: Record<Locale, Dictionary> = { ar, en };

export type RenderedMail = { subject: string; text: string; html: string };

/** Escapes text for an HTML body or attribute (numeric entities for & < > " '). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
