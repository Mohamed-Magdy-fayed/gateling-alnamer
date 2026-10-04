import Link from "next/link";
import { CourseCard } from "@/components/courses/course-card";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { listCoursesForDashboard, listPublishedCourses } from "@/server/catalog/repository";
import { Badge, Card, Container, cn } from "@/ui";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { t, locale } = await getDictionary();
  const { subject } = await searchParams;
  const [all, counts] = await Promise.all([listPublishedCourses(), listCoursesForDashboard()]);
  const lessonCounts = new Map(counts.map((course) => [course.id, course.lessonCount]));
  const subjects = [
    ...new Map(
      all
        .flatMap((course) => course.categories)
        .filter((category) => category.type === "subject")
        .map((category) => [category.slug, pickText(category.name, locale)] as const),
    ),
  ].map(([slug, name]) => ({ slug, name }));
  const courses = subject
    ? all.filter((course) =>
        course.categories.some(
          (category) => category.type === "subject" && category.slug === subject,
        ),
      )
    : all;

  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-shadow hover:shadow-e2",
      active
        ? "border-primary bg-primary-soft text-primary-soft-fg"
        : "border-line-strong bg-raised text-fg",
    );

  return (
    <Container size="marketing" className="py-12 md:py-16">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[clamp(1.875rem,1.5rem+1.6vw,2.5rem)] font-bold">{t.courses.title}</h1>
        <Badge tone="highlight">{t.common.sample}</Badge>
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
        {subjects.map(({ slug, name }) => (
          <Link
            key={slug}
            href={{ pathname: "/courses", query: { subject: slug } }}
            className={chip(subject === slug)}
            aria-current={subject === slug ? "page" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>

      {courses.length === 0 ? (
        <Card className="mt-8 border-dashed p-8 text-center text-fg-2">
          {all.length === 0 ? t.courses.emptyCatalogue : t.courses.empty}
        </Card>
      ) : null}
      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <li key={course.slug}>
            <CourseCard
              t={t}
              locale={locale}
              course={course}
              lessonCount={lessonCounts.get(course.id)}
            />
          </li>
        ))}
      </ul>
    </Container>
  );
}
