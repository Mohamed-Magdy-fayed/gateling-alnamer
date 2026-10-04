import {
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  ReceiptText,
  ShoppingCart,
  UserCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/al/empty-state";
import { linkClass } from "@/components/auth-parts";
import { TeacherOnboarding } from "@/components/teach/onboarding";
import { PublishButton } from "@/components/teach/publish-button";
import type { Dictionary } from "@/i18n/ar";
import { format, formatDate, type Locale } from "@/i18n/config";
import { pickText } from "@/lib/localized-text";
import type { RecentResult } from "@/server/access/quiz";
import type { PendingCourse, TeacherCourseRow } from "@/server/catalog/authoring";
import type { TeacherOnboardingState } from "@/server/catalog/teachers/profile";
import type { StudentCourse } from "@/server/orders/my-courses";
import { Alert, Badge, ButtonLink, Card, Ltr } from "@/ui";

/**
 * Real-user landings (A7a screen map), built only from data that exists today. Anything not built
 * yet is an inert "coming in the full test version" card; the W1 sample figures live in the
 * view-as sample views and never reach these.
 */
const grid = "grid gap-4 md:grid-cols-2";

type StudentLandingProps = {
  t: Dictionary;
  locale: Locale;
  courses: StudentCourse[];
  results: RecentResult[];
};

/** Latest submitted quiz attempts, newest first; an empty state until the first quiz. */
function QuizResults({ t, locale, results }: Omit<StudentLandingProps, "courses">) {
  const s = t.dashboard.student;
  if (results.length === 0) {
    return <EmptyState icon={ClipboardCheck} title={s.quizzes} body={t.quiz.noResults} />;
  }
  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-semibold">{s.quizzes}</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {results.map((result) => (
          <li
            key={`${result.submittedAt.toISOString()}-${result.scorePct}`}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <bdi className="font-medium">{pickText(result.quizTitle, locale)}</bdi>
            <span className="text-fg-muted">
              {format(t.quiz.resultLine, {
                score: result.scorePct,
                date: formatDate(locale, result.submittedAt),
              })}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** My courses (live access first), then ended ones with "Buy again"; quizzes are still planned. */
export function StudentLanding({ t, locale, courses, results }: StudentLandingProps) {
  const s = t.dashboard.student;
  const live = courses.filter((course) => course.active);
  const ended = courses.filter((course) => !course.active);
  return (
    <div className="flex flex-col gap-8">
      {live.length === 0 ? (
        <div className={grid}>
          <EmptyState
            icon={BookOpen}
            title={s.title}
            body={t.dashboard.noCourses}
            action={<ButtonLink href="/courses">{t.dashboard.browseCourses}</ButtonLink>}
          />
          <QuizResults t={t} locale={locale} results={results} />
        </div>
      ) : (
        <section aria-labelledby="my-courses" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="my-courses" className="text-lg font-semibold">
              {s.title}
            </h2>
            <ButtonLink href="/courses" variant="ghost" size="sm" className="min-h-11">
              {t.dashboard.browseCourses}
            </ButtonLink>
          </div>
          <ul className={grid}>
            {live.map((course) => (
              <li key={course.courseId}>
                <Card className="flex h-full flex-col gap-3 p-5">
                  <h3 className="font-semibold">
                    <bdi>{pickText(course.title, locale)}</bdi>
                  </h3>
                  <p className="text-sm text-fg-muted">
                    {format(t.courses.hasAccess, { date: formatDate(locale, course.endsAt) })}
                  </p>
                  {course.firstLessonId ? (
                    <ButtonLink
                      href={`/dashboard/learn/${course.firstLessonId}`}
                      className="mt-auto self-start"
                    >
                      {s.continue}
                    </ButtonLink>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      {live.length > 0 ? (
        <div className={grid}>
          <QuizResults t={t} locale={locale} results={results} />
        </div>
      ) : null}
      {ended.length > 0 ? (
        <section aria-labelledby="ended-courses" className="flex flex-col gap-4">
          <h2 id="ended-courses" className="text-lg font-semibold">
            {s.endedTitle}
          </h2>
          <ul className={grid}>
            {ended.map((course) => (
              <li key={course.courseId}>
                <Card className="flex h-full flex-col gap-3 p-5">
                  <h3 className="font-semibold">
                    <bdi>{pickText(course.title, locale)}</bdi>
                  </h3>
                  <p className="text-sm text-fg-muted">
                    {format(s.endedOn, { date: formatDate(locale, course.endsAt) })}
                  </p>
                  <ButtonLink
                    href={`/courses/${course.slug}`}
                    variant="secondary"
                    className="mt-auto self-start"
                  >
                    {s.buyAgain}
                  </ButtonLink>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Sits under the A6 child cards: buying starts from a course page, which offers the child picker. */
export function ParentLandingExtras({ t }: { t: Dictionary }) {
  const p = t.dashboard.parent;
  return (
    <div className="mt-6">
      <EmptyState
        icon={ShoppingCart}
        title={p.buyFor}
        body={p.buyForBody}
        action={<ButtonLink href="/courses">{t.dashboard.browseCourses}</ButtonLink>}
      />
    </div>
  );
}

export function TeacherLanding({
  t,
  locale,
  courses,
  onboarding,
}: {
  t: Dictionary;
  locale: Locale;
  courses: TeacherCourseRow[];
  /** The teacher's status and terms (C1); null when the account has no teacher profile. */
  onboarding: TeacherOnboardingState | null;
}) {
  const d = t.dashboard.teacher;
  // Anyone who cannot author (applied, rejected, suspended, terms to accept, no profile or no
  // published terms) sees the gate only, never a "new course" button that leads nowhere.
  if (!onboarding?.canAuthor) {
    return (
      <div className="flex flex-col gap-6">
        {onboarding ? (
          <TeacherOnboarding t={t.teachers} locale={locale} state={onboarding} />
        ) : (
          <Alert tone="warning">{t.teachers.status.unavailable}</Alert>
        )}
      </div>
    );
  }
  const newCourse = <ButtonLink href="/dashboard/teach/new">{d.newCourse}</ButtonLink>;
  return (
    <div className="flex flex-col gap-6">
      {courses.length === 0 ? (
        <div className={grid}>
          <EmptyState
            icon={BookOpen}
            title={d.myCourses}
            body={t.teach.noCourses}
            action={newCourse}
          />
        </div>
      ) : (
        <section aria-labelledby="teacher-courses" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="teacher-courses" className="text-lg font-semibold">
              {d.myCourses}
            </h2>
            {newCourse}
          </div>
          <ul className={grid}>
            {courses.map((course) => (
              <li key={course.id}>
                <Card className="flex h-full flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">
                      <bdi>{pickText(course.title, locale)}</bdi>
                    </h3>
                    <Badge tone={course.status === "published" ? "success" : "neutral"}>
                      {t.teach.statuses[course.status]}
                    </Badge>
                  </div>
                  <Link href={`/dashboard/teach/${course.id}`} className={`${linkClass} mt-auto`}>
                    <bdi>{pickText(course.title, locale)}</bdi>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={grid}>
        <EmptyState icon={Wallet} title={d.earnings} comingSoon={t.shell.comingSoon} />
      </div>
    </div>
  );
}

export function AdminLanding({
  t,
  locale,
  pending,
  applications,
}: {
  t: Dictionary;
  locale: Locale;
  pending: PendingCourse[];
  /** Teacher applications waiting for a decision. */
  applications: number;
}) {
  const a = t.dashboard.admin;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="content-review">
        <Card className="flex flex-col gap-4 p-6">
          <h2 id="content-review" className="text-lg font-semibold">
            {a.contentReview}
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm text-fg-muted">{t.teach.pendingEmpty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {pending.map((course) => (
                <li
                  key={course.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex flex-col">
                    <bdi className="font-medium">{pickText(course.title, locale)}</bdi>
                    <span className="text-sm text-fg-muted">
                      {format(t.teach.byTeacher, { name: pickText(course.teacherName, locale) })}
                      {" · "}
                      {formatDate(locale, course.submittedAt)}
                    </span>
                  </div>
                  <PublishButton
                    courseId={course.id}
                    title={pickText(course.title, locale)}
                    t={t.teach}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
      <div className={grid}>
        <section aria-labelledby="teacher-applications">
          <Card className="flex h-full flex-col gap-4 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <UserCheck aria-hidden className="size-5 text-fg-2" strokeWidth={1.75} />
              <h2 id="teacher-applications" className="text-lg font-semibold">
                {a.teacherApplications}
              </h2>
              <Badge tone={applications > 0 ? "warning" : "neutral"}>
                <Ltr>{applications}</Ltr>
              </Badge>
            </div>
            <ButtonLink
              href="/dashboard/admin/teachers"
              variant="outline"
              className="min-h-11 self-start"
            >
              {t.teachers.admin.review}
            </ButtonLink>
          </Card>
        </section>
        <EmptyState icon={ReceiptText} title={a.orders} comingSoon={t.shell.comingSoon} />
      </div>
    </div>
  );
}

export function ReviewerLanding({ t }: { t: Dictionary }) {
  const r = t.dashboard.reviewer;
  return (
    <div className={grid}>
      <EmptyState
        icon={ClipboardList}
        title={r.title}
        body={r.body}
        comingSoon={t.shell.comingSoon}
      />
      <EmptyState
        icon={FileCheck}
        title={t.dashboard.admin.contentReview}
        comingSoon={t.shell.comingSoon}
      />
    </div>
  );
}
