import { toLatinDigits } from "@/lib/digits";

export const INVITE_CODE_LENGTH = 8;
const GROUP_LENGTH = 4;

/** Letters and digits only: Arabic-Indic digits mapped, upper case, no spaces or dashes, at most 8. */
function compactInvite(raw: string): string {
  return toLatinDigits(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, INVITE_CODE_LENGTH);
}

/** What a person typed or pasted as `XXXX-XXXX`. */
export function formatInviteInput(raw: string): string {
  const compact = compactInvite(raw);
  return compact.length > GROUP_LENGTH
    ? `${compact.slice(0, GROUP_LENGTH)}-${compact.slice(GROUP_LENGTH)}`
    : compact;
}

/**
 * The reformatted value and where the caret goes: after the same number of letters and digits that
 * were left of it, so typing in the middle does not jump to the end.
 */
export function reformatInviteWithCaret(
  raw: string,
  caret: number,
): { value: string; caret: number } {
  const value = formatInviteInput(raw);
  const before = compactInvite(raw.slice(0, caret)).length;
  return { value, caret: before > GROUP_LENGTH ? before + 1 : before };
}
