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
import { EmptyState } from "@/components/al/empty-state";
import type { Dictionary } from "@/i18n/ar";
import { format, formatDate, type Locale } from "@/i18n/config";
import { pickText } from "@/lib/localized-text";
import type { RecentResult } from "@/server/access/quiz";
import type { StudentCourse } from "@/server/orders/my-courses";
import { Button, ButtonLink, Card } from "@/ui";

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

export function TeacherLanding({ t }: { t: Dictionary }) {
  const d = t.dashboard.teacher;
  return (
    <div className={grid}>
      <EmptyState
        icon={BookOpen}
        title={d.myCourses}
        body={d.noCourses}
        comingSoon={t.shell.comingSoon}
        action={
          <Button disabled className="min-h-11">
            {d.newCourse}
          </Button>
        }
      />
      <EmptyState icon={Wallet} title={d.earnings} comingSoon={t.shell.comingSoon} />
    </div>
  );
}

export function AdminLanding({ t }: { t: Dictionary }) {
  const a = t.dashboard.admin;
  return (
    <div className={grid}>
      <EmptyState icon={UserCheck} title={a.teacherApplications} comingSoon={t.shell.comingSoon} />
      <EmptyState icon={FileCheck} title={a.contentReview} comingSoon={t.shell.comingSoon} />
      <EmptyState icon={ReceiptText} title={a.orders} comingSoon={t.shell.comingSoon} />
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
