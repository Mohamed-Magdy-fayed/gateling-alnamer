import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import type { LocalizedText } from "@/lib/localized-text";
import { db } from "@/server/db";
import {
  courseRevisions,
  courses,
  entitlements,
  type OrderStatus,
  orders,
  type RefundFlagReason,
  users,
} from "@/server/db/schema";
import { parseOrderNumber } from "./number";

export type OrderView = {
  id: string;
  /** Without the dash; the UI formats it. */
  number: string;
  status: OrderStatus;
  refundFlag: RefundFlagReason | null;
  amountMinor: number;
  currency: string;
  courseId: string;
  courseSlug: string;
  courseTitle: LocalizedText;
  beneficiaryId: string;
  beneficiaryName: string;
  /** The buyer paid for someone else (a parent for a child). */
  forChild: boolean;
  gatewayInvoiceId: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  /** End of the access this order granted, once paid. */
  accessEndsAt: Date | null;
};

/**
 * One order by its number, only for its buyer or its beneficiary. Anyone else, and any malformed
 * or unknown number, gets null (the caller answers not found, never forbidden).
 */
export async function getOrderViewForParty(
  userId: string,
  rawNumber: string,
): Promise<OrderView | null> {
  const number = parseOrderNumber(rawNumber);
  if (!number) return null;
  const [row] = await db()
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      refundFlag: orders.refundFlag,
      amountMinor: orders.amountMinor,
      currency: orders.currency,
      courseId: orders.courseId,
      courseSlug: courses.slug,
      courseTitle: courseRevisions.title,
      beneficiaryId: orders.beneficiaryStudentId,
      buyerId: orders.buyerId,
      beneficiaryName: users.name,
      gatewayInvoiceId: orders.gatewayInvoiceId,
      expiresAt: orders.expiresAt,
      paidAt: orders.paidAt,
      accessEndsAt: sql<Date | null>`(select ${entitlements.endsAt} from ${entitlements} where ${entitlements.orderId} = ${orders.id})`,
    })
    .from(orders)
    .innerJoin(courses, eq(courses.id, orders.courseId))
    .innerJoin(courseRevisions, eq(courseRevisions.id, orders.courseRevisionId))
    .innerJoin(users, eq(users.id, orders.beneficiaryStudentId))
    .where(
      and(
        eq(orders.number, number),
        or(eq(orders.buyerId, userId), eq(orders.beneficiaryStudentId, userId)),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    refundFlag: row.refundFlag,
    amountMinor: row.amountMinor,
    currency: row.currency,
    courseId: row.courseId,
    courseSlug: row.courseSlug,
    courseTitle: row.courseTitle,
    beneficiaryId: row.beneficiaryId,
    beneficiaryName: row.beneficiaryName,
    forChild: row.buyerId !== row.beneficiaryId,
    gatewayInvoiceId: row.gatewayInvoiceId,
    expiresAt: row.expiresAt,
    paidAt: row.paidAt,
    accessEndsAt: row.accessEndsAt ? new Date(row.accessEndsAt) : null,
  };
}
