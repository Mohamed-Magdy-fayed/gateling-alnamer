import type { SessionUser } from "@/server/auth/session";

export const dashboardViews = ["student", "parent", "teacher", "admin", "reviewer"] as const;
export type DashboardView = (typeof dashboardViews)[number];

export function isDashboardView(value: string | undefined): value is DashboardView {
  return dashboardViews.some((view) => view === value);
}

/** The view a signed-in role lands on; every role has its own. */
export function dashboardViewForRole(role: SessionUser["role"]): DashboardView {
  return role;
}
