let override: Date | null = null;

/** Single source of "now" for expiry logic, so tests can pin time. */
export const clock = {
  now(): Date {
    return override ? new Date(override.getTime()) : new Date();
  },
};

/** Test-only. Pass `null` to restore real time. Refused on Vercel. */
export function setClockForTests(fixed: Date | null): void {
  if (process.env.VERCEL) {
    throw new Error("setClockForTests is not allowed when VERCEL is set");
  }
  override = fixed ? new Date(fixed.getTime()) : null;
}
