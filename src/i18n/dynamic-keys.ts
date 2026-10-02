/**
 * Dictionary subtrees read through a runtime key (`t.group[key]`), so a static scan cannot see
 * which leaves are used. Every leaf under a root listed here counts as used by `npm run i18n:check`.
 */
export const DYNAMIC_KEY_ROOTS = [
  "legal", // src/app/(public)/legal/[page]/page.tsx: t.legal[page]
  "dashboard.views", // src/app/(app)/dashboard/page.tsx: t.dashboard.views[user.role]
  "auth.signUp.roles", // src/components/auth-forms.tsx: t.signUp.roles[role]
  "dashboard.admin.orderStatuses", // src/components/dashboard/admin-view.tsx: a.orderStatuses[order.status]
  "dashboard.teacher.statuses", // src/components/dashboard/teacher-view.tsx: d.statuses[status]
] as const;
