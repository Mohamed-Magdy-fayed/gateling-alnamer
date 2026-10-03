/**
 * Procedures that need no sign-in, with the reason each is public. `guards.test.ts` fails when a
 * `publicProcedure` is missing here (or an entry matches no public procedure).
 */
export const PUBLIC_PROCEDURES: Readonly<Record<string, string>> = {
  "health.ping": "Liveness probe; returns only ok and a timestamp.",
  "auth.codeStatus":
    "Reads the caller's own code state; the reset case uses the signed pending cookie and reveals nothing about accounts.",
};
