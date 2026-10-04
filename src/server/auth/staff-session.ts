import { TWO_FACTOR_ENFORCED } from "@/server/config/policy";
import type { UserRole } from "@/server/db/schema";

const STAFF: readonly UserRole[] = ["teacher", "admin", "reviewer"];

export const isStaff = (role: UserRole): boolean => STAFF.includes(role);

/**
 * Whether a session may act as its user outside tRPC and the page guards (route handlers, server
 * actions): staff sessions only after two-factor sign-in passed (A4). Everyone else, always.
 */
export function passesTwoFactor(
  session: { user: { role: UserRole }; twoFactorVerified: boolean } | null,
  enforced: boolean = TWO_FACTOR_ENFORCED,
): boolean {
  if (!session) return false;
  if (!enforced || !isStaff(session.user.role)) return true;
  return session.twoFactorVerified;
}
