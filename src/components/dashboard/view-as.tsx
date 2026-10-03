import Link from "next/link";
import type { Dictionary } from "@/i18n/ar";
import { Badge, cn } from "@/ui";
import { type DashboardView, dashboardViews } from "./views";

/**
 * Demo-only switcher between the W1 sample screens. The page renders it only when
 * `isViewAsEnabled(APP_MODE)`; it never loads another user's data.
 */
export function ViewAs({ t, current }: { t: Dictionary; current: DashboardView | null }) {
  return (
    <nav aria-label={t.dashboard.viewAs} className="flex flex-col gap-1.5">
      <span aria-hidden className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        {t.dashboard.viewAs}
        <Badge tone="highlight">{t.dashboard.samplePreview}</Badge>
      </span>
      <ul className="flex flex-wrap gap-1 rounded-md bg-sunken p-1">
        {dashboardViews.map((item) => (
          <li key={item}>
            <Link
              href={{ pathname: "/dashboard", query: { view: item } }}
              aria-current={item === current ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-sm px-3 text-sm font-medium",
                item === current ? "bg-raised text-fg shadow-e1" : "text-fg-2 hover:text-fg",
              )}
            >
              {t.dashboard.views[item]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
