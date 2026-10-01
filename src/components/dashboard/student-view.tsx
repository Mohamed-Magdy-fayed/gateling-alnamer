import { ArrowLeft, CalendarClock } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/i18n/ar";
import { format, formatDate, type Locale } from "@/i18n/config";
import { mockCourses } from "@/lib/mock-data";
import { Card, Ltr, Progress } from "@/ui";

const progress = [62, 25, 88];
const quizzes = [
  { course: 0, score: 90 },
  { course: 1, score: 74 },
  { course: 2, score: 100 },
];

export function StudentView({ t, locale }: { t: Dictionary; locale: Locale }) {
  const s = t.dashboard.student;
  const mine = mockCourses.slice(0, 3);
  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <section aria-labelledby="my-courses">
        <h2 id="my-courses" className="mb-4 text-lg font-semibold">
          {s.title}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {mine.map((course, index) => (
            <li key={course.slug}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <h3 className="font-semibold">
                  <bdi>{course.title[locale]}</bdi>
                </h3>
                <p className="text-sm text-fg-muted">{course.teacher[locale]}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fg-2">{s.progress}</span>
                  <Ltr className="font-medium">{progress[index] ?? 0}%</Ltr>
                </div>
                <Progress value={progress[index] ?? 0} label={s.progress} />
                <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <CalendarClock aria-hidden className="size-3.5" strokeWidth={1.75} />
                  {format(s.expires, { date: formatDate(locale, new Date("2027-06-30")) })}
                </p>
                <Link
                  href={`/dashboard/learn/${course.sections[0]?.lessons[0]?.id ?? ""}`}
                  className="mt-auto inline-flex items-center gap-1.5 self-start rounded-[var(--radius-sm)] text-sm font-medium text-primary hover:underline"
                >
                  {s.continue}
                  <ArrowLeft aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="quizzes">
        <h2 id="quizzes" className="mb-4 text-lg font-semibold">
          {s.quizzes}
        </h2>
        <Card className="divide-y divide-line">
          {quizzes.map((quiz) => (
            <div key={quiz.course} className="flex items-center justify-between gap-3 p-4 text-sm">
              <bdi className="flex-1">{mockCourses[quiz.course]?.title[locale]}</bdi>
              <span className="font-semibold text-success">
                <Ltr>{format(s.score, { score: quiz.score })}</Ltr>
              </span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
