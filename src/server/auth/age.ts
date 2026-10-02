export const ADULT_AGE = 18;
export const MIN_BIRTH_YEAR = 1940;
const CALENDAR_TIME_ZONE = "Africa/Cairo";

export type IsoDate = { year: number; month: number; day: number };

/** Today's calendar date in Africa/Cairo as `YYYY-MM-DD`. */
export function cairoToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Parses a real calendar date written `YYYY-MM-DD`; null for anything else (31 Feb, 13th month, junk). */
export function parseIsoDate(value: string): IsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/** True when the person has not yet had their 18th birthday on the Cairo calendar date of `now`. */
export function isUnder18(dateOfBirth: string, now: Date): boolean {
  const born = parseIsoDate(dateOfBirth);
  const today = parseIsoDate(cairoToday(now));
  if (!born || !today) return false;
  const eighteenth = born.year + ADULT_AGE;
  const reached =
    today.year > eighteenth ||
    (today.year === eighteenth &&
      (today.month > born.month || (today.month === born.month && today.day >= born.day)));
  return !reached;
}
