import { ArrowLeft, CalendarClock } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/i18n/ar";
import { format, formatDate, type Locale } from "@/i18n/config";
import { pickText } from "@/lib/localized-text";
import type { DashboardCourse } from "@/server/catalog/types";
import { Badge, Card, Ltr, Progress } from "@/ui";

const progress = [62, 25, 88];
const quizzes = [
  { course: 0, score: 90 },
  { course: 1, score: 74 },
  { course: 2, score: 100 },
];

export function StudentView({
  t,
  locale,
  courses,
}: {
  t: Dictionary;
  locale: Locale;
  courses: DashboardCourse[];
}) {
  const s = t.dashboard.student;
  const mine = courses.slice(0, 3);
  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <section aria-labelledby="my-courses">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="my-courses" className="text-lg font-semibold">
            {s.title}
          </h2>
          <Badge tone="highlight" data-testid="sample-progress">
            {t.common.sample}
          </Badge>
        </div>
        {mine.length === 0 ? (
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
        <ul className="grid gap-4 sm:grid-cols-2">
          {mine.map((course, index) => (
            <li key={course.id}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <h3 className="font-semibold">
                  <bdi>{pickText(course.title, locale)}</bdi>
                </h3>
                <p className="text-sm text-fg-muted">
                  <bdi>{pickText(course.teacher, locale)}</bdi>
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fg-2">{s.progress}</span>
                  <Ltr className="font-medium">{progress[index] ?? 0}%</Ltr>
                </div>
                <Progress value={progress[index] ?? 0} label={s.progress} />
                <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <CalendarClock aria-hidden className="size-3.5" strokeWidth={1.75} />
                  {format(s.expires, { date: formatDate(locale, new Date("2027-06-30")) })}
                </p>
                {course.firstLessonId ? (
                  <Link
                    href={`/dashboard/learn/${course.firstLessonId}`}
                    className="mt-auto inline-flex min-h-11 items-center gap-1.5 self-start rounded-[var(--radius-sm)] text-sm font-medium text-primary hover:underline"
                  >
                    {s.continue}
                    <ArrowLeft aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
                  </Link>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="quizzes">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="quizzes" className="text-lg font-semibold">
            {s.quizzes}
          </h2>
          <Badge tone="highlight" data-testid="sample-quizzes">
            {t.common.sample}
          </Badge>
        </div>
        <Card className="divide-y divide-line">
          {quizzes.map((quiz) => {
            const quizCourse = courses[quiz.course];
            return (
              <div
                key={quiz.course}
                className="flex items-center justify-between gap-3 p-4 text-sm"
              >
                <bdi className="flex-1">{quizCourse ? pickText(quizCourse.title, locale) : ""}</bdi>
                <span className="font-semibold text-success">
                  <Ltr>{format(s.score, { score: quiz.score })}</Ltr>
                </span>
              </div>
            );
          })}
        </Card>
      </section>
    </div>
  );
}
