import Link from "next/link";
import { linkClass } from "@/components/auth-parts";
import { AdminView } from "@/components/dashboard/admin-view";
import { ParentView } from "@/components/dashboard/parent-view";
import { ReviewerView } from "@/components/dashboard/reviewer-view";
import { StudentView } from "@/components/dashboard/student-view";
import { TeacherView } from "@/components/dashboard/teacher-view";
import {
  type DashboardView,
  dashboardViewForRole,
  dashboardViews,
  isDashboardView,
} from "@/components/dashboard/views";
import { SoftWarning } from "@/components/devices/soft-warning";
import { ParentCards } from "@/components/parents/parent-cards";
import { format } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { shouldPromptParentLink } from "@/server/auth/profile";
import { requireUser } from "@/server/auth/session";
import { listCoursesForDashboard } from "@/server/catalog/repository";
import { loadParentDashboard } from "@/server/parents/dashboard";
import { Alert, Badge, Container, cn } from "@/ui";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; notice?: string }>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDictionary();
  const { view: requested, notice } = await searchParams;
  const ownView = dashboardViewForRole(user.role);
  const view: DashboardView = isDashboardView(requested) ? requested : ownView;
  // A real parent sees their children; any other role previewing the parent view sees the sample.
  const ownParentCards = user.role === "parent" && view === "parent";
  const [courses, promptParentLink, parentData] = await Promise.all([
    listCoursesForDashboard(),
    shouldPromptParentLink(user.id),
    ownParentCards ? loadParentDashboard(user.id) : null,
  ]);

  return (
    <Container className="py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t.dashboard.hello} <bdi>{user.name}</bdi>
          </h1>
          <p className="text-sm text-fg-muted">
            {format(t.dashboard.roleLabel, { role: t.dashboard.views[ownView] })}
          </p>
        </div>
        <nav aria-label={t.dashboard.viewAs} className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            {t.dashboard.viewAs}
            <Badge tone="highlight">{t.common.sample}</Badge>
          </span>
          <ul className="flex flex-wrap gap-1 rounded-md bg-sunken p-1">
            {dashboardViews.map((item) => (
              <li key={item}>
                <Link
                  href={{ pathname: "/dashboard", query: { view: item } }}
                  aria-current={item === view ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center rounded-sm px-3 text-sm font-medium",
                    item === view ? "bg-raised text-fg shadow-e1" : "text-fg-2 hover:text-fg",
                  )}
                >
                  {t.dashboard.views[item]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {notice === "device-over" && user.role === "student" ? (
        <div className="mt-6">
          <SoftWarning message={t.devices.softWarning} />
        </div>
      ) : null}

      {promptParentLink ? (
        <div className="mt-6">
          <Alert tone="info">
            {t.auth.states.linkParent}{" "}
            <Link href="/dashboard/link-parent" className={linkClass}>
              {t.parents.linkAction}
            </Link>
          </Alert>
        </div>
      ) : null}

      <div className="mt-8">
        {view === "student" ? <StudentView t={t} locale={locale} courses={courses} /> : null}
        {view === "parent" && parentData ? (
          <ParentCards data={parentData} t={{ parents: t.parents, auth: t.auth }} locale={locale} />
        ) : null}
        {view === "parent" && !parentData ? <ParentView t={t} locale={locale} /> : null}
        {view === "teacher" ? <TeacherView t={t} locale={locale} courses={courses} /> : null}
        {view === "reviewer" ? <ReviewerView t={t} /> : null}
        {view === "admin" ? <AdminView t={t} locale={locale} courses={courses} /> : null}
      </div>
    </Container>
  );
}
