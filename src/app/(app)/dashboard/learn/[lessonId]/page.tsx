import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { VideoPlayer } from "@/components/player/video-player";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { getLessonAccess } from "@/server/access/lesson-access";
import { requirePageUser } from "@/server/auth/page-guard";
import { watermarkNumber } from "@/server/auth/profile";
import { getCurrentSession } from "@/server/auth/session";
import { getPublishedLesson } from "@/server/catalog/repository";
import { clock } from "@/server/clock";
import { Alert, Badge, ButtonLink, Container, Ltr } from "@/ui";

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  await requirePageUser(`/dashboard/learn/${encodeURIComponent(lessonId)}`);
  // Same request-cached session the guard read; the access decision needs its device.
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in"); // unreachable after the guard; narrows the type
  // The single access decision (MASTER-PLAN 3.1): entitlement, device and role, before any lesson data.
  const access = await getLessonAccess(
    { id: session.user.id, role: session.user.role, deviceId: session.deviceId },
    lessonId,
    clock.now(),
  );
  if (!access.allowed) {
    if (access.reason === "device_inactive") {
      // A student with no active device (a session from before the limit, or a revoked device)
      // goes through /devices/check, which registers this browser or blocks it.
      redirect(`/devices/check?next=${encodeURIComponent(`/dashboard/learn/${lessonId}`)}`);
    }
    if (access.reason === "not_found" || access.reason === "not_published") notFound();
    const { t } = await getDictionary();
    const lesson = access.reason === "parent" ? null : await getPublishedLesson(lessonId);
    const message =
      access.reason === "parent"
        ? t.parents.cannotPlay
        : access.reason === "expired"
          ? t.orders.accessEnded
          : access.reason === "revoked"
            ? t.orders.accessStopped
            : t.orders.noAccess;
    return (
      <Container className="py-8">
        <Alert>{message}</Alert>
        <div className="mt-4 flex flex-wrap gap-2">
          {lesson ? (
            <ButtonLink href={`/courses/${lesson.course.slug}`}>{t.orders.viewCourse}</ButtonLink>
          ) : null}
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] text-sm text-fg-2 hover:text-fg"
          >
            <ArrowRight aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
            {t.dashboard.player.back}
          </Link>
        </div>
      </Container>
    );
  }
  const lesson = await getPublishedLesson(lessonId);
  if (!lesson) notFound();
  const user = session.user;
  const { t, locale } = await getDictionary();
  const p = t.dashboard.player;
  const accountNumber = await watermarkNumber(user.id);

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

      <div className="mt-6">
        <VideoPlayer
          lessonId={lessonId}
          watermarkName={user.name}
          watermarkNumber={accountNumber}
          t={t.dashboard}
        />
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
