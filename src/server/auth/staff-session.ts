import { TWO_FACTOR_ENFORCED } from "@/server/config/policy";
import type { UserRole } from "@/server/db/schema";

// The one definition of "staff" and of the two-factor rule for them (A4/A7b). Page guards, tRPC,
// route handlers, server actions and Google linking all read it from here.

export const STAFF_ROLES = ["teacher", "admin", "reviewer"] as const satisfies readonly UserRole[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: UserRole): role is StaffRole {
  return (STAFF_ROLES as readonly UserRole[]).includes(role);
}

let enforcedGetter: () => boolean = () => TWO_FACTOR_ENFORCED;

/** Whether staff need a two-factor-verified session (TWO_FACTOR_ENFORCED, or the test override). */
export function twoFactorEnforced(): boolean {
  return enforcedGetter();
}

/** Test hook: pass a getter to override `TWO_FACTOR_ENFORCED`, or null to restore it. Throws outside tests. */
export function setTwoFactorEnforcedForTests(getter: (() => boolean) | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error('setTwoFactorEnforcedForTests is only available when NODE_ENV is "test"');
  }
  enforcedGetter = getter ?? (() => TWO_FACTOR_ENFORCED);
}

type SessionLike = { user: { role: UserRole; status?: string }; twoFactorVerified: boolean };

/**
 * Whether a session may act as its user (pages, tRPC, route handlers, server actions): staff
 * sessions only after two-factor sign-in passed. Everyone else, always.
 */
export function passesTwoFactor(
  session: SessionLike | null,
  enforced: boolean = twoFactorEnforced(),
): boolean {
  if (!session) return false;
  if (!enforced || !isStaffRole(session.user.role)) return true;
  return session.twoFactorVerified;
}

/**
 * A staff session for the two-factor screens and staff-only server actions: active staff only,
 * and when `verified` is asked for, two-factor must have passed. Null for anyone else.
 */
export function staffSessionOrNull<T extends SessionLike>(
  session: T | null,
  { verified }: { verified: boolean },
): T | null {
  if (!session || !isStaffRole(session.user.role)) return null;
  if (session.user.status !== undefined && session.user.status !== "active") return null;
  if (verified && !session.twoFactorVerified) return null;
  return session;
}
