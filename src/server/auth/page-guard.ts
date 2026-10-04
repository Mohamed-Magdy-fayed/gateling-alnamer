import "server-only";
import { redirect } from "next/navigation";
import type { UserRole } from "@/server/db/schema";
import { safeNextPath } from "@/server/devices/next-path";
import { getCurrentSession, getCurrentUser, type SessionUser } from "./session";
import { isStaffRole, passesTwoFactor, twoFactorEnforced } from "./staff-session";
import { twoFactorStatus } from "./two-factor";

/**
 * The one guard every page under `src/app/(app)` calls first (`page-guard.test.ts` scans for it).
 * A visitor without a session goes to sign-in carrying the page they wanted (`next` is cleaned by
 * `safeNextPath`, so a crafted value falls back to the dashboard).
 */
export async function requirePageUser(next?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(safeNextPath(next))}`);
  await requireTwoFactorForStaff(user, next);
  return user;
}

/**
 * Staff (teacher, admin, reviewer) reach app pages only with a two-factor-verified session: to the
 * challenge when enrolled, otherwise to enrolment, keeping where they were going.
 */
async function requireTwoFactorForStaff(user: SessionUser, next?: string): Promise<void> {
  if (!twoFactorEnforced() || !isStaffRole(user.role)) return;
  const session = await getCurrentSession();
  if (passesTwoFactor(session)) return;
  const { enrolled } = await twoFactorStatus(user.id);
  const target = enrolled ? "/two-factor" : "/two-factor/setup";
  redirect(`${target}?next=${encodeURIComponent(safeNextPath(next))}`);
}

/** Signed in and in one of `roles`; any other role is sent to its own dashboard. */
export async function requirePageRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requirePageUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}
