import { Clock, PlayCircle } from "lucide-react";
import Link from "next/link";
import { format } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { formatPrice, lessonCount, mockCourses } from "@/lib/mock-data";
import { Badge, Card, Container, cn, Ltr } from "@/ui";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { t, locale } = await getDictionary();
  const { subject } = await searchParams;
  const subjects = [...new Set(mockCourses.map((course) => course.subject[locale]))];
  const courses = subject
    ? mockCourses.filter((course) => course.subject[locale] === subject)
    : mockCourses;

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-4 py-2 text-sm transition-shadow hover:shadow-e2",
      active
        ? "border-primary bg-primary-soft text-primary-soft-fg"
        : "border-line-strong bg-raised text-fg",
    );

  return (
    <Container size="marketing" className="py-12 md:py-16">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[clamp(1.875rem,1.5rem+1.6vw,2.5rem)] font-bold">{t.courses.title}</h1>
        <Badge tone="accent">{t.common.sample}</Badge>
      </div>
      <p className="mt-2 text-fg-2">{t.courses.lead}</p>

      <nav aria-label={t.courses.filterSubject} className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/courses"
          className={chip(!subject)}
          aria-current={!subject ? "page" : undefined}
        >
          {t.courses.all}
        </Link>
        {subjects.map((name) => (
          <Link
            key={name}
            href={{ pathname: "/courses", query: { subject: name } }}
            className={chip(subject === name)}
            aria-current={subject === name ? "page" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>

      {courses.length === 0 ? (
        <p className="mt-8 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-raised p-8 text-center text-fg-2">
          {t.courses.empty}
        </p>
      ) : null}
      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <li key={course.slug}>
            <Link
              href={`/courses/${course.slug}`}
              className="group block h-full rounded-[var(--radius-md)]"
            >
              <Card className="flex h-full flex-col gap-3 p-5 transition-shadow group-hover:shadow-e2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="primary">{course.subject[locale]}</Badge>
                  <Badge>{course.grade[locale]}</Badge>
                </div>
                <h2 className="text-lg font-semibold">
                  <bdi>{course.title[locale]}</bdi>
                </h2>
                <p className="text-sm text-fg-muted">{course.curriculum[locale]}</p>
                <p className="text-sm text-fg-2">
                  {format(t.courses.by, { name: course.teacher[locale] })}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                  <span className="flex items-center gap-3 text-fg-muted">
                    <span className="flex items-center gap-1">
                      <PlayCircle aria-hidden className="size-4" strokeWidth={1.75} />
                      {format(t.courses.lessonsCount, { count: lessonCount(course) })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock aria-hidden className="size-4" strokeWidth={1.75} />
                      {format(t.courses.hours, { count: course.hours })}
                    </span>
                  </span>
                  <span className="font-semibold text-primary">
                    <Ltr>{formatPrice(locale, course.priceMinor, t.common.currency)}</Ltr>
                  </span>
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
