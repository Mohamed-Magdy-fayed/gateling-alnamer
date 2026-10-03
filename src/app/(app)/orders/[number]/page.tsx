import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CheckAgainButton, TryAgainButton } from "@/components/orders/order-actions";
import type { Dictionary } from "@/i18n/ar";
import { format, formatDate, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { formatPrice } from "@/lib/money-format";
import { requirePageUser } from "@/server/auth/page-guard";
import { getPublishedCourseBySlug } from "@/server/catalog/repository";
import { formatOrderNumber } from "@/server/orders/number";
import { getOrderViewForParty, type OrderView } from "@/server/orders/views";
import { Alert, ButtonLink, Card, Container, Ltr } from "@/ui";

type Outcome = { title: string; body: ReactNode; action: ReactNode };

function outcomeOf(
  order: OrderView,
  t: Dictionary,
  locale: Locale,
  firstLessonId: string | null,
  /** The viewer bought it for someone else (a parent): no play controls, ever. */
  buyerForChild: boolean,
): Outcome {
  const o = t.orders;
  const texts = { orders: o, courses: t.courses, auth: t.auth };
  const coursePath = `/courses/${order.courseSlug}`;
  switch (order.status) {
    case "pending":
      return {
        title: o.pendingTitle,
        body: <p className="text-fg-2">{o.pendingBody}</p>,
        action: <CheckAgainButton number={order.number} t={texts} />,
      };
    case "paid": {
      if (order.refundFlag === "paid_after_access_end") {
        return {
          title: o.lateTitle,
          body: <p className="text-fg-2">{o.lateBody}</p>,
          action: null,
        };
      }
      const second =
        order.refundFlag === "duplicate" ? <Alert tone="info">{o.secondPayment}</Alert> : null;
      if (buyerForChild) {
        return {
          title: o.paidTitle,
          body: (
            <>
              <p className="text-fg-2">{o.childCanStart}</p>
              {second}
            </>
          ),
          action: null,
        };
      }
      return {
        title: o.paidTitle,
        body: (
          <>
            <p className="text-fg-2">{o.paidBody}</p>
            {second}
          </>
        ),
        action: firstLessonId ? (
          <ButtonLink href={`/dashboard/learn/${firstLessonId}`} className="self-start">
            {t.courses.startLearning}
          </ButtonLink>
        ) : null,
      };
    }
    case "paid_duplicate":
      return {
        title: o.duplicateTitle,
        body: (
          <p className="text-fg-2">{format(o.duplicateBody, { name: order.beneficiaryName })}</p>
        ),
        action: null,
      };
    case "failed":
      return {
        title: o.failedTitle,
        body: <p className="text-fg-2">{o.failedBody}</p>,
        action: (
          <TryAgainButton
            courseId={order.courseId}
            beneficiaryId={buyerForChild ? order.beneficiaryId : null}
            label={o.tryAgain}
            locale={locale}
            t={texts}
          />
        ),
      };
    case "expired":
    case "cancelled":
      return {
        title: o.expiredTitle,
        body: <p className="text-fg-2">{o.expiredBody}</p>,
        action: (
          <ButtonLink href={coursePath} className="self-start">
            {o.buyAgain}
          </ButtonLink>
        ),
      };
    case "refunded":
      return { title: o.refundedTitle, body: null, action: null };
  }
}

/** One order for its buyer or beneficiary: what happened, and the one next step. */
export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const user = await requirePageUser(`/orders/${encodeURIComponent(number)}`);
  const order = await getOrderViewForParty(user.id, number);
  if (!order) notFound();
  const { t, locale } = await getDictionary();
  const o = t.orders;
  const buyerForChild = order.forChild && user.id !== order.beneficiaryId;
  // "Start learning" goes to the first lesson; only the student who has the course needs it.
  const course =
    order.status === "paid" && !buyerForChild
      ? await getPublishedCourseBySlug(order.courseSlug)
      : null;
  const firstLessonId = course?.sections[0]?.lessons[0]?.id ?? null;
  const outcome = outcomeOf(order, t, locale, firstLessonId, buyerForChild);
  const accessUntil =
    order.accessEndsAt && order.status === "paid"
      ? format(t.courses.accessUntil, { date: formatDate(locale, order.accessEndsAt) })
      : null;

  return (
    <Container className="py-8">
      <Link
        href={`/courses/${order.courseSlug}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] text-sm text-fg-2 hover:text-fg"
      >
        <ArrowRight aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
        {o.backToCourse}
      </Link>
      <Card className="mt-4 flex max-w-2xl flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-balance">{outcome.title}</h1>
          {outcome.body}
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-fg-muted">{o.numberLabel}</dt>
          <dd className="font-medium">
            <Ltr>{formatOrderNumber(order.number)}</Ltr>
          </dd>
          <dt className="text-fg-muted">{o.courseLabel}</dt>
          <dd className="font-medium">
            <bdi>{pickText(order.courseTitle, locale)}</bdi>
            {accessUntil ? (
              <span className="block font-normal text-fg-muted">{accessUntil}</span>
            ) : null}
          </dd>
          <dt className="text-fg-muted">{o.amountLabel}</dt>
          <dd className="font-medium">
            <Ltr>{formatPrice(locale, order.amountMinor, order.currency)}</Ltr>
          </dd>
          {order.forChild ? (
            <>
              <dt className="text-fg-muted">{o.forLabel}</dt>
              <dd className="font-medium">
                <bdi>{order.beneficiaryName}</bdi>
              </dd>
            </>
          ) : null}
        </dl>
        {outcome.action}
      </Card>
    </Container>
  );
}
