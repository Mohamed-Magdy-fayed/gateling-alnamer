import { Plus } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/i18n/ar";
import { type Locale, plural } from "@/i18n/config";
import { pickText } from "@/lib/localized-text";
import { formatPrice } from "@/lib/money-format";
import type { DashboardCourse } from "@/server/catalog/types";
import { Badge, Button, Card, Ltr } from "@/ui";

const statuses = ["published", "review", "draft"] as const;
const studentCounts = [42, 17, 0];
const tones = {
  published: "success",
  review: "warning",
  draft: "neutral",
} as const;

export function TeacherView({
  t,
  locale,
  courses,
}: {
  t: Dictionary;
  locale: Locale;
  courses: DashboardCourse[];
}) {
  const d = t.dashboard.teacher;
  const stats = [
    { label: d.sales, value: 1260000 },
    { label: d.pendingBalance, value: 845000 },
    { label: d.paidOut, value: 2400000 },
  ];
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="earnings">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="earnings" className="text-lg font-semibold">
            {d.earnings}
          </h2>
          <Badge tone="highlight" data-testid="sample-earnings">
            {t.common.sample}
          </Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {stats.map((stat, index) => (
            <Card key={stat.label} className={index === 0 ? "bg-primary-soft p-5" : "p-5"}>
              <p className={index === 0 ? "text-sm text-primary-soft-fg" : "text-sm text-fg-2"}>
                {stat.label}
              </p>
              <p
                className={
                  index === 0
                    ? "mt-1 text-2xl font-bold text-primary-soft-fg"
                    : "mt-1 text-2xl font-bold"
                }
              >
                <Ltr>{formatPrice(locale, stat.value, t.common.currency)}</Ltr>
              </p>
            </Card>
          ))}
        </div>
      </section>
      <section aria-labelledby="teacher-courses">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="teacher-courses" className="text-lg font-semibold">
              {d.myCourses}
            </h2>
            <Badge tone="highlight" data-testid="sample-teacher-courses">
              {t.common.sample}
            </Badge>
          </div>
          <Button size="sm" disabled aria-describedby="new-course-note">
            <Plus aria-hidden className="size-4" strokeWidth={1.75} />
            {d.newCourse}
          </Button>
        </div>
        <p id="new-course-note" className="-mt-2 mb-4 text-xs text-fg-muted">
          {t.common.comingInFullVersion}
        </p>
        {courses.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {t.dashboard.noCourses}{" "}
            <Link
              href="/courses"
              className="inline-flex min-h-11 items-center text-primary underline"
            >
              {t.dashboard.browseCourses}
            </Link>
          </p>
        ) : null}
        <Card className="divide-y divide-line">
          {courses.slice(0, 3).map((course, index) => {
            const status = statuses[index] ?? "draft";
            return (
              <div key={course.id} className="flex flex-wrap items-center gap-3 p-4">
                <bdi className="min-w-0 flex-1 font-medium">{pickText(course.title, locale)}</bdi>
                <span className="text-sm text-fg-muted">
                  {plural(locale, d.studentsCount, studentCounts[index] ?? 0)}
                </span>
                <Badge tone={tones[status]}>{d.statuses[status]}</Badge>
              </div>
            );
          })}
        </Card>
      </section>
    </div>
  );
}
