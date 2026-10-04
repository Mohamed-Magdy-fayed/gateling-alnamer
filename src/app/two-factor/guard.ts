import "server-only";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/auth/session";
import { isStaffRole } from "@/server/auth/staff-session";
import { safeNextPath } from "@/server/devices/next-path";

/**
 * The two-factor pages are for a signed-in staff member whose session is not verified yet.
 * Anyone else goes where they belong: signed out to sign-in, students and parents and verified
 * staff to where they were going.
 */
export async function requireUnverifiedStaff(rawNext: string | undefined) {
  const next = safeNextPath(rawNext);
  const session = await getCurrentSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!isStaffRole(session.user.role) || session.twoFactorVerified) redirect(next);
  return { session, next };
}
