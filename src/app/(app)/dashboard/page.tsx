import Link from "next/link";
import { AdminView } from "@/components/dashboard/admin-view";
import { ParentView } from "@/components/dashboard/parent-view";
import { StudentView } from "@/components/dashboard/student-view";
import { TeacherView } from "@/components/dashboard/teacher-view";
import { format } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { requireUser } from "@/server/auth/session";
import { listCoursesForDashboard } from "@/server/catalog/repository";
import { Badge, Container, cn } from "@/ui";

const views = ["student", "parent", "teacher", "admin"] as const;
type View = (typeof views)[number];

function isView(value: string | undefined): value is View {
  return views.some((view) => view === value);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDictionary();
  const { view: requested } = await searchParams;
  const view: View = isView(requested) ? requested : user.role;
  const courses = await listCoursesForDashboard();

  return (
    <Container className="py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{format(t.dashboard.hello, { name: user.name })}</h1>
          <p className="text-sm text-fg-muted">
            {format(t.dashboard.roleLabel, { role: t.dashboard.views[user.role] })}
          </p>
        </div>
        <nav aria-label={t.dashboard.viewAs} className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            {t.dashboard.viewAs}
            <Badge tone="highlight">{t.common.sample}</Badge>
          </span>
          <ul className="flex flex-wrap gap-1 rounded-[var(--radius-md)] bg-sunken p-1">
            {views.map((item) => (
              <li key={item}>
                <Link
                  href={{ pathname: "/dashboard", query: { view: item } }}
                  aria-current={item === view ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center rounded-[var(--radius-sm)] px-3 text-sm font-medium",
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

      <div className="mt-8">
        {view === "student" ? <StudentView t={t} locale={locale} courses={courses} /> : null}
        {view === "parent" ? <ParentView t={t} locale={locale} /> : null}
        {view === "teacher" ? <TeacherView t={t} locale={locale} courses={courses} /> : null}
        {view === "admin" ? <AdminView t={t} locale={locale} courses={courses} /> : null}
      </div>
    </Container>
  );
}
