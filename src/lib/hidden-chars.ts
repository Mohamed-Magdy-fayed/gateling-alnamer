/**
 * Characters nobody sees: C0/C1 controls (NUL breaks an insert), zero-width and direction marks,
 * bidi overrides and isolates, and the BOM. They can reorder or spoof a name, so they are dropped.
 * Written as escapes so no invisible character sits in the source.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const HIDDEN = /[\u0000-\u001F\u007F-\u009F؜​-‏‪-‮⁦-⁩﻿]/g;

/** The text without hidden characters, trimmed. */
export function stripHidden(value: string): string {
  return value.replace(HIDDEN, "").trim();
}
