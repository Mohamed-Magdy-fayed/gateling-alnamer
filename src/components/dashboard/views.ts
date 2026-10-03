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

export type AppMode = "demo" | "live";

/** The "view as" switcher exists only in the demo; it shows W1 sample screens, never real data. */
export function isViewAsEnabled(mode: AppMode): boolean {
  return mode === "demo";
}

/** The sample view a `?view=` asks for, or null (own landing). Always null outside the demo. */
export function resolveView(mode: AppMode, requested: string | undefined): DashboardView | null {
  return isViewAsEnabled(mode) && isDashboardView(requested) ? requested : null;
}
