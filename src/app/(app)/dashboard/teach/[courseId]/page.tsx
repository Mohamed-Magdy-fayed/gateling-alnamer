import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { linkClass } from "@/components/auth-parts";
import { SubmitReviewButton } from "@/components/teach/submit-review-button";
import { format } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { formatPrice } from "@/lib/money-format";
import { requirePageRole } from "@/server/auth/page-guard";
import { getTeacherCourse } from "@/server/catalog/authoring";
import { getPlatformSettings } from "@/server/settings/repository";
import { Alert, Badge, Card, Container, Ltr } from "@/ui";

const courseIdSchema = z.uuid();

export default async function DraftCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const user = await requirePageRole("teacher");
  const course = courseIdSchema.safeParse(courseId).success
    ? await getTeacherCourse(user.id, courseId)
    : null;
  if (!course) notFound();
  const [{ t, locale }, settings] = await Promise.all([getDictionary(), getPlatformSettings()]);
  const tt = t.teach;

  return (
    <Container className="py-8">
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] text-sm text-fg-2 hover:text-fg"
      >
        <ArrowRight aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
        {tt.backToCourses}
      </Link>
      <Card className="mt-4 flex max-w-2xl flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">
            <bdi>{pickText(course.title, locale)}</bdi>
          </h1>
          <Badge tone={course.status === "published" ? "success" : "neutral"}>
            {tt.statuses[course.status]}
          </Badge>
        </div>
        <p className="text-fg-2">
          <bdi>{pickText(course.description, locale)}</bdi>
        </p>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-fg-muted">{tt.priceGroup}</dt>
          <dd className="font-medium">
            <Ltr>{formatPrice(locale, course.priceMinor, settings.currency)}</Ltr>
            {course.accessDays ? (
              <span className="block font-normal text-fg-muted">
                {format(t.courses.accessDays, { days: course.accessDays })}
              </span>
            ) : null}
          </dd>
          <dt className="text-fg-muted">{tt.lessonGroup}</dt>
          <dd className="font-medium">
            {course.lessonTitle ? <bdi>{pickText(course.lessonTitle, locale)}</bdi> : null}
            {course.freePreview ? (
              <Badge tone="success" className="ms-2">
                {t.courses.freePreview}
              </Badge>
            ) : null}
          </dd>
        </dl>
        {course.status === "draft" ? <SubmitReviewButton courseId={course.id} t={tt} /> : null}
        {course.status === "in_review" ? <Alert>{tt.waiting}</Alert> : null}
        {course.status === "published" ? (
          <Alert tone="success">
            {tt.publishedNote}{" "}
            <Link href={`/courses/${course.slug}`} className={linkClass}>
              {tt.viewInCatalogue}
            </Link>
          </Alert>
        ) : null}
      </Card>
    </Container>
  );
}
