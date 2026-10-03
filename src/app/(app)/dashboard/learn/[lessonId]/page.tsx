import { ArrowRight, PlayCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { requirePageUser } from "@/server/auth/page-guard";
import { getCurrentSession } from "@/server/auth/session";
import { getPublishedLesson } from "@/server/catalog/repository";
import { assertActiveDevice } from "@/server/devices/service";
import { lessonDenial } from "@/server/parents/lesson-access";
import { Alert, Badge, Container, Ltr } from "@/ui";

const lessonIdSchema = z.uuid();

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  await requirePageUser(`/dashboard/learn/${encodeURIComponent(lessonId)}`);
  // Same request-cached session the guard read; needed for the device binding.
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in"); // unreachable after the guard; narrows the type
  // Parents never play paid content; deny before any lesson data is loaded. T1's getLessonAccess takes over.
  if (lessonDenial(session.user.role) === "cannotPlay") {
    const { t } = await getDictionary();
    return (
      <Container className="py-8">
        <Alert>{t.parents.cannotPlay}</Alert>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] text-sm text-fg-2 hover:text-fg"
        >
          <ArrowRight aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
          {t.dashboard.player.back}
        </Link>
      </Container>
    );
  }
  // A malformed id would make Postgres throw (22P02); treat it as not found.
  const lesson = lessonIdSchema.safeParse(lessonId).success
    ? await getPublishedLesson(lessonId)
    : null;
  if (!lesson) notFound();
  // Paid content needs an active device. A student with none (a session from before the limit, or a
  // revoked device) goes through /devices/check, which registers this browser or blocks it.
  const access = await assertActiveDevice({
    role: session.user.role,
    deviceId: session.deviceId,
  });
  if (!access.ok) {
    redirect(`/devices/check?next=${encodeURIComponent(`/dashboard/learn/${lessonId}`)}`);
  }
  const user = session.user;
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
        <Badge tone="highlight">{t.common.sample}</Badge>
        <h1 className="text-xl font-bold">
          <bdi>{pickText(lesson.title, locale)}</bdi>
        </h1>
      </div>
      <p className="text-sm text-fg-muted">
        <bdi>{pickText(lesson.course.title, locale)}</bdi>
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
