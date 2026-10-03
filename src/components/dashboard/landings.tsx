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
import { ButtonLink } from "@/ui";

/**
 * Real-user landings (A7a screen map), built only from data that exists today. Anything not built
 * yet is an inert "coming in the full test version" card; the W1 sample figures live in the
 * view-as sample views and never reach these.
 */
const grid = "grid gap-4 md:grid-cols-2";

export function StudentLanding({ t }: { t: Dictionary }) {
  const s = t.dashboard.student;
  return (
    <div className={grid}>
      <EmptyState
        icon={BookOpen}
        title={s.title}
        body={t.dashboard.noCourses}
        action={<ButtonLink href="/courses">{t.dashboard.browseCourses}</ButtonLink>}
      />
      <EmptyState icon={ClipboardCheck} title={s.quizzes} comingSoon={t.shell.comingSoon} />
    </div>
  );
}

/** Sits under the A6 child cards: buying for a child is not built yet. */
export function ParentLandingExtras({ t }: { t: Dictionary }) {
  const p = t.dashboard.parent;
  return (
    <div className="mt-6">
      <EmptyState
        icon={ShoppingCart}
        title={p.buyFor}
        body={p.buyForSoon}
        comingSoon={t.shell.comingSoon}
      />
    </div>
  );
}

export function TeacherLanding({ t }: { t: Dictionary }) {
  const d = t.dashboard.teacher;
  return (
    <div className={grid}>
      <EmptyState icon={BookOpen} title={d.myCourses} comingSoon={t.shell.comingSoon} />
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
