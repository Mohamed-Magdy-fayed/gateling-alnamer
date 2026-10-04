import { Clock, PlayCircle } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/i18n/ar";
import { type Locale, plural } from "@/i18n/config";
import { pickText } from "@/lib/localized-text";
import { formatPrice } from "@/lib/money-format";
import type { CatalogCategory, CategoryType, CourseSummary } from "@/server/catalog/types";
import { Badge, Card, Ltr } from "@/ui";

type Props = {
  t: Dictionary;
  locale: Locale;
  course: CourseSummary;
  lessonCount?: number;
  /** The card title's heading level: h2 on the catalogue, h3 under a section heading. */
  headingLevel?: "h2" | "h3";
};

function categoryName(categories: CatalogCategory[], type: CategoryType, locale: Locale): string {
  const found = categories.find((category) => category.type === type);
  return found ? pickText(found.name, locale) : "";
}

/** A published course as a link card (catalogue, teacher profile). */
export function CourseCard({ t, locale, course, lessonCount, headingLevel = "h2" }: Props) {
  const subjectName = categoryName(course.categories, "subject", locale);
  const gradeName = categoryName(course.categories, "grade", locale);
  const curriculumName = categoryName(course.categories, "curriculum", locale);
  const Heading = headingLevel;
  return (
    <Link
      href={`/courses/${course.slug}`}
      className="group block h-full rounded-[var(--radius-md)]"
    >
      <Card className="flex h-full flex-col gap-3 p-5 transition-shadow group-hover:shadow-e2">
        {subjectName || gradeName ? (
          <div className="flex flex-wrap gap-1.5">
            {subjectName ? <Badge tone="primary">{subjectName}</Badge> : null}
            {gradeName ? <Badge>{gradeName}</Badge> : null}
          </div>
        ) : null}
        <Heading className="text-lg font-semibold">
          <bdi>{pickText(course.title, locale)}</bdi>
        </Heading>
        {curriculumName ? <p className="text-sm text-fg-muted">{curriculumName}</p> : null}
        <p className="text-sm text-fg-2">
          {t.courses.by} <bdi>{pickText(course.teacher.name, locale)}</bdi>
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
          <span className="flex items-center gap-3 text-fg-muted">
            {lessonCount ? (
              <span className="flex items-center gap-1">
                <PlayCircle aria-hidden className="size-4" strokeWidth={1.75} />
                {plural(locale, t.courses.lessonsCount, lessonCount)}
              </span>
            ) : null}
            {course.estimatedHours ? (
              <span className="flex items-center gap-1">
                <Clock aria-hidden className="size-4" strokeWidth={1.75} />
                {plural(locale, t.courses.hours, course.estimatedHours)}
              </span>
            ) : null}
          </span>
          <span className="font-semibold text-primary">
            <Ltr>{formatPrice(locale, course.priceMinor, t.common.currency)}</Ltr>
          </span>
        </div>
      </Card>
    </Link>
  );
}
