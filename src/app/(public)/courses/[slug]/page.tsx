import { ArrowRight, CalendarClock, FileText, ListChecks, Lock, PlayCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatCount, formatDate } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { formatPrice } from "@/lib/money-format";
import { getPublishedCourseBySlug } from "@/server/catalog/repository";
import type { CatalogCategory, CategoryType, LessonKind } from "@/server/catalog/types";
import { Alert, Badge, Button, Card, Container, Ltr } from "@/ui";

const kindIcon: Record<LessonKind, typeof PlayCircle> = {
  video: PlayCircle,
  pdf: FileText,
  image: FileText,
  quiz: ListChecks,
};

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = await getPublishedCourseBySlug(slug);
  if (!course) notFound();
  const { t, locale } = await getDictionary();

  const categoryName = (categories: CatalogCategory[], type: CategoryType) => {
    const found = categories.find((category) => category.type === type);
    return found ? pickText(found.name, locale) : "";
  };

  const access =
    course.access.kind === "fixed_end"
      ? format(t.courses.accessUntil, { date: formatDate(locale, course.access.endAt) })
      : format(t.courses.accessDays, { days: course.access.days });

  return (
    <Container size="marketing" className="py-10 md:py-14">
      <Link
        href="/courses"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] text-sm text-fg-2 hover:text-fg"
      >
        <ArrowRight aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
        {t.courses.back}
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="highlight">{t.common.sample}</Badge>
            <Badge tone="primary">{categoryName(course.categories, "subject")}</Badge>
            <Badge>{categoryName(course.categories, "grade")}</Badge>
            <Badge>{categoryName(course.categories, "curriculum")}</Badge>
          </div>
          <h1 className="text-[clamp(1.875rem,1.5rem+1.6vw,2.5rem)] font-bold">
            <bdi>{pickText(course.title, locale)}</bdi>
          </h1>
          <p className="text-lg leading-[1.8] text-fg-2">
            <bdi>{pickText(course.description, locale)}</bdi>
          </p>

          <section aria-labelledby="outline">
            <h2 id="outline" className="mb-4 text-xl font-semibold">
              {t.courses.outline}
            </h2>
            <div className="flex flex-col gap-4">
              {course.sections.map((section) => (
                <Card key={section.id} className="overflow-hidden">
                  <h3 className="bg-sunken px-4 py-3 font-semibold">
                    <bdi>{pickText(section.title, locale)}</bdi>
                  </h3>
                  <ul className="divide-y divide-line">
                    {section.lessons.map((lesson) => {
                      const Icon = kindIcon[lesson.kind];
                      return (
                        <li key={lesson.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                          <Icon aria-hidden className="size-4 text-fg-muted" strokeWidth={1.75} />
                          <span className="flex-1">
                            <bdi>{pickText(lesson.title, locale)}</bdi>
                          </span>
                          {lesson.durationMinutes ? (
                            <span className="text-fg-muted">
                              {formatCount(locale, t.courses.minutes, lesson.durationMinutes)}
                            </span>
                          ) : null}
                          {lesson.isFreePreview ? (
                            <Badge tone="success">{t.courses.freePreview}</Badge>
                          ) : (
                            <Lock aria-label={t.courses.locked} className="size-4 text-fg-muted" />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ))}
            </div>
          </section>

          <section aria-labelledby="teacher" className="flex flex-col gap-2">
            <h2 id="teacher" className="text-xl font-semibold">
              {t.courses.aboutTeacher}
            </h2>
            <p className="font-medium">
              <bdi>{pickText(course.teacher.name, locale)}</bdi>
            </p>
            <p className="text-fg-2">
              <bdi>{pickText(course.teacher.bio, locale)}</bdi>
            </p>
          </section>
        </div>

        <aside className="order-first lg:order-none lg:sticky lg:top-24 lg:self-start">
          <Card className="flex flex-col gap-4 p-6 shadow-e2">
            <p className="text-3xl font-bold text-primary">
              <Ltr>{formatPrice(locale, course.priceMinor, t.common.currency)}</Ltr>
            </p>
            <p className="flex items-center gap-2 text-sm text-fg-2">
              <CalendarClock aria-hidden className="size-4" strokeWidth={1.75} />
              {access}
            </p>
            <Button size="lg" disabled aria-describedby="buy-note">
              {t.courses.buy}
            </Button>
            <div id="buy-note">
              <Alert>{t.courses.buyNote}</Alert>
            </div>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
