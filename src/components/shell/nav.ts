import type { UserRole } from "@/server/db/schema";

/** Icon names the shell maps to lucide components (A7a.3); kept as data so this file stays server-safe. */
export type NavIconName = "home" | "account" | "link" | "plus" | "teachers";

export type NavItem = {
  href: string;
  /** Dotted path into the dictionary (`common.dashboard`); the shell resolves it with `t`. */
  labelKey: string;
  icon: NavIconName;
};

const home: NavItem = { href: "/dashboard", labelKey: "common.dashboard", icon: "home" };
const account: NavItem = {
  href: "/dashboard/account",
  labelKey: "devices.accountTitle",
  icon: "account",
};
const newCourse: NavItem = {
  href: "/dashboard/teach/new",
  labelKey: "dashboard.teacher.newCourse",
  icon: "plus",
};
const adminTeachers: NavItem = {
  href: "/dashboard/admin/teachers",
  labelKey: "teachers.admin.title",
  icon: "teachers",
};
const linkParent: NavItem = {
  href: "/dashboard/link-parent",
  labelKey: "parents.linkAction",
  icon: "link",
};

/**
 * Live routes only, per role (A7a screen map). Planned features are EmptyState cards on the
 * landings, never nav links. `nav.test.ts` checks that every href has a page and that no role
 * lists another role's page.
 */
export const NAV: Record<UserRole, NavItem[]> = {
  student: [home, linkParent, account],
  parent: [home, account],
  teacher: [home, newCourse, account],
  admin: [home, adminTeachers, account],
  reviewer: [home, account],
};
