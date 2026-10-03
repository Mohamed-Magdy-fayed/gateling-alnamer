import "server-only";
import { redirect } from "next/navigation";
import type { UserRole } from "@/server/db/schema";
import { safeNextPath } from "@/server/devices/next-path";
import { getCurrentUser, type SessionUser } from "./session";

/**
 * The one guard every page under `src/app/(app)` calls first (`page-guard.test.ts` scans for it).
 * A visitor without a session goes to sign-in carrying the page they wanted (`next` is cleaned by
 * `safeNextPath`, so a crafted value falls back to the dashboard).
 */
export async function requirePageUser(next?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(safeNextPath(next))}`);
  return user;
}

/** Signed in and in one of `roles`; any other role is sent to its own dashboard. */
export async function requirePageRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requirePageUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}
