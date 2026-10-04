import Link from "next/link";
import { linkClass } from "@/components/auth-parts";
import { AdminView } from "@/components/dashboard/admin-view";
import {
  AdminLanding,
  ParentLandingExtras,
  ReviewerLanding,
  StudentLanding,
  TeacherLanding,
} from "@/components/dashboard/landings";
import { ParentView } from "@/components/dashboard/parent-view";
import { ReviewerView } from "@/components/dashboard/reviewer-view";
import { StudentView } from "@/components/dashboard/student-view";
import { TeacherView } from "@/components/dashboard/teacher-view";
import { ViewAs } from "@/components/dashboard/view-as";
import { isViewAsEnabled, resolveView } from "@/components/dashboard/views";
import { SoftWarning } from "@/components/devices/soft-warning";
import { ParentCards } from "@/components/parents/parent-cards";
import { format } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { listRecentResults } from "@/server/access/quiz";
import { requirePageUser } from "@/server/auth/page-guard";
import { shouldPromptParentLink } from "@/server/auth/profile";
import { listPendingReview, listTeacherCourses } from "@/server/catalog/authoring";
import { listCoursesForDashboard } from "@/server/catalog/repository";
import { teacherOnboardingState } from "@/server/catalog/teachers/profile";
import { countTeacherApplications } from "@/server/catalog/teachers/review";
import { clock } from "@/server/clock";
import { serverEnv } from "@/server/env";
import { listStudentCourses } from "@/server/orders/my-courses";
import { loadParentDashboard } from "@/server/parents/dashboard";
import { Alert, Container } from "@/ui";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; notice?: string }>;
}) {
  const user = await requirePageUser();
  const { t, locale } = await getDictionary();
  const { view: requested, notice } = await searchParams;
  const mode = serverEnv().APP_MODE;
  // A sample preview (demo only) shows the W1 sample screens; otherwise the user's own landing.
  const sample = resolveView(mode, requested);
  const [
    courses,
    promptParentLink,
    parentData,
    myCourses,
    quizResults,
    teaching,
    pending,
    onboard,
    applications,
  ] = await Promise.all([
    sample ? listCoursesForDashboard() : [],
    shouldPromptParentLink(user),
    !sample && user.role === "parent" ? loadParentDashboard(user.id) : null,
    !sample && user.role === "student" ? listStudentCourses(user.id, clock.now()) : [],
    !sample && user.role === "student" ? listRecentResults(user.id) : [],
    !sample && user.role === "teacher" ? listTeacherCourses(user.id) : [],
    !sample && user.role === "admin" ? listPendingReview() : [],
    !sample && user.role === "teacher" ? teacherOnboardingState(user.id) : null,
    !sample && user.role === "admin" ? countTeacherApplications() : 0,
  ]);

  return (
    <Container className="py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t.dashboard.hello} <bdi>{user.name}</bdi>
          </h1>
          <p className="text-sm text-fg-muted">
            {format(t.dashboard.roleLabel, { role: t.dashboard.views[user.role] })}
          </p>
        </div>
        {isViewAsEnabled(mode) ? <ViewAs t={t} current={sample} /> : null}
      </div>

      {notice === "device-over" && user.role === "student" ? (
        <div className="mt-6">
          <SoftWarning message={t.devices.softWarning} />
        </div>
      ) : null}

      {promptParentLink ? (
        <div className="mt-6">
          <Alert tone="info">
            {t.auth.states.linkParent}{" "}
            <Link href="/dashboard/link-parent" className={linkClass}>
              {t.parents.linkAction}
            </Link>
          </Alert>
        </div>
      ) : null}

      <div className="mt-8">
        {sample === "student" ? <StudentView t={t} locale={locale} courses={courses} /> : null}
        {sample === "parent" ? <ParentView t={t} locale={locale} /> : null}
        {sample === "teacher" ? <TeacherView t={t} locale={locale} courses={courses} /> : null}
        {sample === "reviewer" ? <ReviewerView t={t} /> : null}
        {sample === "admin" ? <AdminView t={t} locale={locale} courses={courses} /> : null}
        {sample === null && user.role === "student" ? (
          <StudentLanding t={t} locale={locale} courses={myCourses} results={quizResults} />
        ) : null}
        {sample === null && user.role === "parent" && parentData ? (
          <>
            <ParentCards
              data={parentData}
              t={{ parents: t.parents, auth: t.auth }}
              locale={locale}
            />
            <ParentLandingExtras t={t} />
          </>
        ) : null}
        {sample === null && user.role === "teacher" ? (
          <TeacherLanding t={t} locale={locale} courses={teaching} onboarding={onboard} />
        ) : null}
        {sample === null && user.role === "reviewer" ? <ReviewerLanding t={t} /> : null}
        {sample === null && user.role === "admin" ? (
          <AdminLanding t={t} locale={locale} pending={pending} applications={applications} />
        ) : null}
      </div>
    </Container>
  );
}
