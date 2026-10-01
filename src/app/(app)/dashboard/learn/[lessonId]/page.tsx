import { ArrowRight, PlayCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n/server";
import { mockCourses } from "@/lib/mock-data";
import { requireUser } from "@/server/auth/session";
import { Alert, Badge, Container, Ltr } from "@/ui";

function findLesson(id: string) {
  for (const course of mockCourses) {
    for (const section of course.sections) {
      const lesson = section.lessons.find((item) => item.id === id);
      if (lesson) return { course, lesson };
    }
  }
  return null;
}

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const found = findLesson(lessonId);
  if (!found) notFound();
  const user = await requireUser();
  const { t, locale } = await getDictionary();
  const p = t.dashboard.player;
  const accountNumber = `AN-${user.id.slice(0, 6).toUpperCase()}`;

  return (
    <Container className="py-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] text-sm text-fg-2 hover:text-fg"
      >
        <ArrowRight aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
        {p.back}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone="accent">{t.common.sample}</Badge>
        <h1 className="text-xl font-bold">
          <bdi>{found.lesson.title[locale]}</bdi>
        </h1>
      </div>
      <p className="text-sm text-fg-muted">
        <bdi>{found.course.title[locale]}</bdi>
      </p>

      {/* Media stays LTR by convention (DESIGN.md section 7). */}
      <div
        dir="ltr"
        className="relative mt-6 aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] bg-media shadow-e3"
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-media-fg">
          <PlayCircle aria-hidden className="size-16" strokeWidth={1.25} />
          <span className="text-sm" dir="auto">
            {p.videoPlaceholder}
          </span>
        </div>
        <div className="pointer-events-none absolute start-[10%] top-[8%] select-none">
          <div className="watermark-walk rounded px-2 py-1 text-sm font-medium text-media-fg/55">
            <bdi>{user.name}</bdi> · {accountNumber}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Alert>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck aria-hidden className="size-4" strokeWidth={1.75} />
            {p.watermarkNote}
          </span>{" "}
          <Ltr>{accountNumber}</Ltr>
        </Alert>
      </div>
    </Container>
  );
}
