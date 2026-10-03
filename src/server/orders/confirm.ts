import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import {
  courseRevisions,
  entitlements,
  type OrderRow,
  type OrderStatus,
  orders,
  type RefundFlagReason,
} from "@/server/db/schema";
import {
  InvoiceNotFoundError,
  type PaymentGateway,
  type PaymentStatus,
  paymentGateway,
} from "@/server/payments/gateway";
import { type AccessTerms, computeAccessWindow } from "./access-window";
import { lockStudentCourse } from "./lock";

type Database = ReturnType<typeof db>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ConfirmResult =
  | { kind: "not_found" }
  | { kind: "mismatch"; orderId: string }
  | {
      kind: "order";
      orderId: string;
      orderNumber: string;
      status: OrderStatus;
      refundFlag: RefundFlagReason | null;
    };

export type ConfirmDeps = { readonly gateway?: PaymentGateway };

const PAID_STATUSES: readonly OrderStatus[] = ["paid", "paid_duplicate", "refunded"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function summarise(order: OrderRow): ConfirmResult {
  return {
    kind: "order",
    orderId: order.id,
    orderNumber: order.number,
    status: order.status,
    refundFlag: order.refundFlag,
  };
}

async function loadOrder(id: string): Promise<OrderRow | null> {
  const [order] = await db().select().from(orders).where(eq(orders.id, id)).limit(1);
  return order ?? null;
}

async function setPendingTo(order: OrderRow, status: "failed" | "expired"): Promise<OrderRow> {
  const [updated] = await db()
    .update(orders)
    .set({ status, updatedAt: clock.now() })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
    .returning();
  return updated ?? (await loadOrder(order.id)) ?? order;
}

function termsOf(revision: {
  accessKind: "fixed_end" | "duration_days";
  accessEndAt: Date | null;
  accessDays: number | null;
}): AccessTerms {
  if (revision.accessKind === "fixed_end" && revision.accessEndAt) {
    return { kind: "fixed_end", endAt: revision.accessEndAt };
  }
  if (revision.accessKind === "duration_days" && revision.accessDays) {
    return { kind: "duration_days", days: revision.accessDays };
  }
  throw new Error("course revision has inconsistent access fields");
}

/** The paid branch, in one transaction under a lock on the order (and on the student's course). */
async function applyPaid(
  tx: Tx,
  orderId: string,
  invoiceId: string,
  payment: PaymentStatus,
): Promise<OrderRow> {
  const [peek] = await tx
    .select({ beneficiary: orders.beneficiaryStudentId, courseId: orders.courseId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!peek) throw new Error("order vanished during confirmation");
  // Same lock key as checkout, taken before the row lock so both paths order their locks alike.
  await lockStudentCourse(tx, peek.beneficiary, peek.courseId);
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) throw new Error("order vanished during confirmation");
  if (PAID_STATUSES.includes(order.status)) {
    if (order.gatewayInvoiceId === invoiceId) return order;
    if (order.refundFlag) {
      // Already flagged for another reason: one flag column cannot hold a second extra payment.
      // Loud log until P4's payment_events records every payment (STATE carry-over).
      console.error(`[payments] extra paid invoice ${invoiceId} on flagged order ${order.id}`);
      return order;
    }
    // A different invoice of an already-paid order was also paid: the buyer was charged twice.
    // Keep the status and the first payment ids, grant nothing, flag it for a refund.
    console.warn(`[payments] second paid invoice ${invoiceId} for order ${order.id}`);
    const [flagged] = await tx
      .update(orders)
      .set({ refundFlag: "duplicate", updatedAt: clock.now() })
      .where(eq(orders.id, order.id))
      .returning();
    return flagged ?? order;
  }

  const [revision] = await tx
    .select({
      accessKind: courseRevisions.accessKind,
      accessEndAt: courseRevisions.accessEndAt,
      accessDays: courseRevisions.accessDays,
    })
    .from(courseRevisions)
    .where(eq(courseRevisions.id, order.courseRevisionId))
    .limit(1);
  if (!revision) throw new Error("order references a missing course revision");

  const paidAt = clock.now();
  const window = computeAccessWindow(paidAt, termsOf(revision));
  const paidFields = {
    paidAt,
    gatewayInvoiceId: invoiceId,
    gatewayPaymentId: payment.paymentId ?? null,
    gatewayFeeMinor: payment.feeMinor ?? null,
    updatedAt: paidAt,
  };

  let status: OrderStatus = "paid";
  let refundFlag: RefundFlagReason | null = null;
  if (!window) {
    refundFlag = "paid_after_access_end";
  } else {
    const [overlap] = await tx
      .select({ id: entitlements.id })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.studentId, order.beneficiaryStudentId),
          eq(entitlements.courseId, order.courseId),
          sql`${entitlements.revokedAt} is null`,
          gt(entitlements.endsAt, paidAt),
        ),
      )
      .limit(1);
    if (overlap) {
      status = "paid_duplicate";
      refundFlag = "duplicate";
    }
  }

  const [updated] = await tx
    .update(orders)
    .set({ ...paidFields, status, refundFlag })
    .where(eq(orders.id, order.id))
    .returning();
  if (!updated) throw new Error("order update returned no row");

  if (window && status === "paid") {
    await tx
      .insert(entitlements)
      .values({
        id: uuidv7(),
        studentId: order.beneficiaryStudentId,
        courseId: order.courseId,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        source: "order",
        orderId: order.id,
        isSample: order.isSample,
      })
      .onConflictDoNothing({ target: entitlements.orderId });
  }
  return updated;
}

/**
 * The only writer of paid state. Asks the gateway for the invoice's status (never trusts the
 * caller), finds the order by the gateway's customer reference, and requires amount and currency
 * to match before any effect. A gateway `paid` is applied whatever the local status; replaying it
 * in any order yields one paid order and one entitlement.
 */
export async function confirmPayment(
  invoiceId: string,
  deps: ConfirmDeps = {},
): Promise<ConfirmResult> {
  const gateway = deps.gateway ?? paymentGateway();
  let payment: PaymentStatus;
  try {
    payment = await gateway.getPaymentStatus(invoiceId);
  } catch (error) {
    if (error instanceof InvoiceNotFoundError) return { kind: "not_found" };
    throw error;
  }
  if (!UUID_PATTERN.test(payment.customerReference)) return { kind: "not_found" };

  const order = await loadOrder(payment.customerReference);
  if (!order) return { kind: "not_found" };
  if (order.amountMinor !== payment.amountMinor || order.currency !== payment.currency) {
    // Ids only: the amounts are not secret but the P4 payment_events row will carry them.
    console.error(`[payments] amount mismatch for order ${order.id} invoice ${invoiceId}`);
    return { kind: "mismatch", orderId: order.id };
  }

  switch (payment.status) {
    case "pending":
      return summarise(order);
    case "failed":
    case "expired":
      return summarise(
        order.status === "pending" ? await setPendingTo(order, payment.status) : order,
      );
    case "paid": {
      const applied = await db().transaction((tx) => applyPaid(tx, order.id, invoiceId, payment));
      return summarise(applied);
    }
  }
}
