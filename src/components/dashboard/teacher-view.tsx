import { Plus } from "lucide-react";
import type { Dictionary } from "@/i18n/ar";
import type { Locale } from "@/i18n/config";
import { formatPrice, mockCourses } from "@/lib/mock-data";
import { Badge, Button, Card, Ltr } from "@/ui";

const statuses = ["published", "review", "draft"] as const;
const studentCounts = [42, 17, 0];
const tones = { published: "success", review: "warning", draft: "neutral" } as const;

export function TeacherView({ t, locale }: { t: Dictionary; locale: Locale }) {
  const d = t.dashboard.teacher;
  const stats = [
    { label: d.sales, value: 1260000 },
    { label: d.pendingBalance, value: 845000 },
    { label: d.paidOut, value: 2400000 },
  ];
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="earnings">
        <h2 id="earnings" className="mb-4 text-lg font-semibold">
          {d.earnings}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {stats.map((stat, index) => (
            <Card key={stat.label} className={index === 0 ? "bg-primary-soft p-5" : "p-5"}>
              <p className="text-sm text-fg-2">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold">
                <Ltr>{formatPrice(locale, stat.value, t.common.currency)}</Ltr>
              </p>
            </Card>
          ))}
        </div>
      </section>
      <section aria-labelledby="teacher-courses">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="teacher-courses" className="text-lg font-semibold">
            {d.myCourses}
          </h2>
          <Button size="sm" disabled>
            <Plus aria-hidden className="size-4" strokeWidth={1.75} />
            {d.newCourse}
          </Button>
        </div>
        <Card className="divide-y divide-line">
          {mockCourses.slice(0, 3).map((course, index) => {
            const status = statuses[index] ?? "draft";
            return (
              <div key={course.slug} className="flex flex-wrap items-center gap-3 p-4">
                <bdi className="min-w-0 flex-1 font-medium">{course.title[locale]}</bdi>
                <span className="text-sm text-fg-muted">
                  <Ltr>{studentCounts[index] ?? 0}</Ltr> {d.students}
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
