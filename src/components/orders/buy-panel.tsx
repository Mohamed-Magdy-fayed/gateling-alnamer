import Link from "next/link";
import { linkClass } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { format, formatDate, type Locale } from "@/i18n/config";
import type { BuyState } from "@/server/orders/buy-state";
import { Alert, ButtonLink } from "@/ui";
import { BuyBox } from "./buy-box";

type Props = {
  state: BuyState;
  courseId: string;
  slug: string;
  firstLessonId: string | null;
  locale: Locale;
  t: Dictionary;
  /** Demo deployments take test payments only; the panel says so next to the button. */
  demo: boolean;
};

/** The course page's buy box, by viewer: each refusal is explained before the click. */
export function BuyPanel({ state, courseId, slug, firstLessonId, locale, t, demo }: Props) {
  const c = t.courses;
  const testNote = demo ? <p className="text-sm text-fg-muted">{c.testPayments}</p> : null;
  const verifyLink = (
    <Link href="/verify-email" className={linkClass}>
      {t.auth.verify.bannerAction}
    </Link>
  );

  switch (state.kind) {
    case "anonymous":
      return (
        <ButtonLink size="lg" href={`/sign-in?next=${encodeURIComponent(`/courses/${slug}`)}`}>
          {c.buy}
        </ButtonLink>
      );
    case "not_buyer":
      return null;
    case "student_can_buy":
      return (
        <>
          <BuyBox courseId={courseId} locale={locale} t={c} authT={t.auth} />
          {testNote}
        </>
      );
    case "student_has_access":
      return (
        <>
          <Alert tone="success">
            {format(c.hasAccess, { date: formatDate(locale, state.endsAt) })}
          </Alert>
          {firstLessonId ? (
            <ButtonLink size="lg" href={`/dashboard/learn/${firstLessonId}`}>
              {c.startLearning}
            </ButtonLink>
          ) : null}
        </>
      );
    case "student_verify_email":
      return (
        <Alert tone="info">
          {c.verifyToBuy} {verifyLink}
        </Alert>
      );
    case "student_ask_parent":
      return <Alert tone="info">{c.askParent}</Alert>;
    case "parent_verify_email":
      return (
        <Alert tone="info">
          {c.parentVerify} {verifyLink}
        </Alert>
      );
    case "parent_no_children":
      return (
        <Alert tone="info">
          {c.parentNoChildren}{" "}
          <Link href="/dashboard" className={linkClass}>
            {c.goToChildren}
          </Link>
        </Alert>
      );
    case "parent":
      return (
        <>
          <BuyBox
            courseId={courseId}
            locale={locale}
            t={c}
            authT={t.auth}
            beneficiaries={state.children.map((child) => ({
              id: child.id,
              name: child.name,
              accessUntil: child.accessEndsAt ? formatDate(locale, child.accessEndsAt) : null,
            }))}
          />
          {testNote}
        </>
      );
  }
}
