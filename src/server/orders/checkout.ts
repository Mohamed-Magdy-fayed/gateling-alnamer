import "server-only";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { type AbuseDeps, guardCheckout } from "@/server/auth/abuse";
import { sampleVisible } from "@/server/catalog/visibility";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import {
  courseRevisions,
  courses,
  entitlements,
  type OrderRow,
  orders,
  parentLinks,
  teacherProfiles,
  type UserRole,
  users,
} from "@/server/db/schema";
import { serverEnv } from "@/server/env";
import { type PaymentGateway, paymentGateway } from "@/server/payments/gateway";
import { readPlatformSettings } from "@/server/settings/repository";
import { type CheckoutTarget, decideCheckoutActor } from "./checkout-policy";
import { lockStudentCourse } from "./lock";
import { generateOrderNumber } from "./number";

const DEFAULT_INVOICE_TTL_HOURS = 24;
const DEFAULT_COMMISSION_BP = 7000;
const HOUR_MS = 60 * 60 * 1000;
/** Retries for a lost race on the pending index or an order-number clash. */
const MAX_RESERVE_ATTEMPTS = 4;

type Database = ReturnType<typeof db>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CheckoutInput = {
  buyer: { id: string; role: UserRole; name: string };
  courseId: string;
  /** Required for a parent: the linked child the course is for. */
  beneficiaryStudentId?: string;
  locale?: string;
};

export type CheckoutDeps = AbuseDeps & {
  readonly gateway?: PaymentGateway;
  readonly appMode?: "demo" | "live";
};

export type CheckoutRefusal =
  | "forbidden"
  | "ask_parent"
  | "verify_email"
  | "not_linked"
  | "not_found"
  | "not_for_sale"
  | "access_ended"
  | "rate_limited";

export type CheckoutResult =
  | { ok: true; orderId: string; orderNumber: string; paymentUrl: string }
  | { ok: false; reason: CheckoutRefusal }
  | { ok: false; reason: "already_has_access"; endsAt: Date }
  | { ok: false; reason: "try_again"; orderNumber: string };

type Terms = {
  courseId: string;
  revisionId: string;
  priceMinor: number;
  accessKind: "fixed_end" | "duration_days";
  accessEndAt: Date | null;
  isSample: boolean;
};

type Snapshot = {
  currency: string;
  teacherRateBp: number;
  invoiceTtlMs: number;
};

async function resolveTarget(
  input: CheckoutInput,
): Promise<{ target: CheckoutTarget; beneficiaryId: string | null }> {
  const { buyer, beneficiaryStudentId } = input;
  if (!beneficiaryStudentId) return { target: "none", beneficiaryId: null };
  if (beneficiaryStudentId === buyer.id) return { target: "self", beneficiaryId: buyer.id };
  if (buyer.role !== "parent") return { target: "unlinked", beneficiaryId: null };
  const [link] = await db()
    .select({ studentId: parentLinks.studentId })
    .from(parentLinks)
    .innerJoin(users, eq(users.id, parentLinks.studentId))
    .where(
      and(
        eq(parentLinks.parentId, buyer.id),
        eq(parentLinks.studentId, beneficiaryStudentId),
        eq(users.role, "student"),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return link
    ? { target: "linked_child", beneficiaryId: link.studentId }
    : { target: "unlinked", beneficiaryId: null };
}

async function loadTerms(courseId: string): Promise<Terms | null> {
  const [row] = await db()
    .select({
      courseId: courses.id,
      revisionId: courseRevisions.id,
      priceMinor: courseRevisions.priceMinor,
      accessKind: courseRevisions.accessKind,
      accessEndAt: courseRevisions.accessEndAt,
      isSample: courses.isSample,
    })
    .from(courses)
    .innerJoin(courseRevisions, eq(courseRevisions.id, courses.publishedRevisionId))
    .innerJoin(users, eq(users.id, courses.teacherId))
    .innerJoin(teacherProfiles, eq(teacherProfiles.userId, courses.teacherId))
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.status, "published"),
        eq(teacherProfiles.status, "approved"),
        sampleVisible(courses.isSample),
        sampleVisible(users.isSample),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The latest end of the beneficiary's active access to the course, or null. */
async function activeAccessEnd(
  executor: Pick<Tx, "select">,
  studentId: string,
  courseId: string,
  now: Date,
) {
  const [row] = await executor
    .select({ endsAt: sql<Date | null>`max(${entitlements.endsAt})` })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.studentId, studentId),
        eq(entitlements.courseId, courseId),
        sql`${entitlements.revokedAt} is null`,
        gt(entitlements.endsAt, now),
      ),
    );
  return row?.endsAt ? new Date(row.endsAt) : null;
}

type Reservation = {
  buyerId: string;
  beneficiaryId: string;
  terms: Terms;
  snapshot: Snapshot;
};

function snapshotValues(reservation: Reservation, now: Date) {
  const { terms, snapshot } = reservation;
  return {
    courseRevisionId: terms.revisionId,
    listPriceMinor: terms.priceMinor,
    discountMinor: 0,
    amountMinor: terms.priceMinor,
    currency: snapshot.currency,
    teacherRateBp: snapshot.teacherRateBp,
    expiresAt: new Date(now.getTime() + snapshot.invoiceTtlMs),
    updatedAt: now,
  };
}

type Reserved =
  | { kind: "order"; order: OrderRow; cancelInvoiceIds: string[] }
  | { kind: "has_access"; endsAt: Date };

/**
 * Under the student+course lock (shared with confirmPayment): refuse if access is already live;
 * reuse this buyer's live pending order; retry this buyer's failed order on its own row when the
 * course terms have not changed (same amount, so a late payment on its old invoice still matches);
 * otherwise open a new order. A pending order of another buyer (another parent, or the student) is
 * expired, never handed over: its buyer stays the payer of record. Invoices of orders this replaces
 * are returned for cancelling after the commit.
 */
async function reserveOrder(tx: Tx, reservation: Reservation, now: Date): Promise<Reserved> {
  const { beneficiaryId, buyerId, terms } = reservation;
  await lockStudentCourse(tx, beneficiaryId, terms.courseId);
  const endsAt = await activeAccessEnd(tx, beneficiaryId, terms.courseId, now);
  if (endsAt) return { kind: "has_access", endsAt };

  const open = await tx
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.beneficiaryStudentId, beneficiaryId),
        eq(orders.courseId, terms.courseId),
        inArray(orders.status, ["pending", "failed"]),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .for("update");
  const cancelInvoiceIds: string[] = [];

  const pending = open.find((order) => order.status === "pending");
  if (pending && pending.buyerId === buyerId && pending.expiresAt.getTime() > now.getTime()) {
    return { kind: "order", order: pending, cancelInvoiceIds };
  }
  if (pending) {
    await tx
      .update(orders)
      .set({ status: "expired", updatedAt: now })
      .where(eq(orders.id, pending.id));
    if (pending.gatewayInvoiceId) cancelInvoiceIds.push(pending.gatewayInvoiceId);
  }

  const failed = open.find((order) => order.status === "failed" && order.buyerId === buyerId);
  if (failed) {
    if (failed.courseRevisionId === terms.revisionId) {
      // Same terms: only the expiry moves. The old invoice id stays until the new one replaces it.
      const [retried] = await tx
        .update(orders)
        .set({
          status: "pending",
          expiresAt: new Date(now.getTime() + reservation.snapshot.invoiceTtlMs),
          updatedAt: now,
        })
        .where(eq(orders.id, failed.id))
        .returning();
      if (retried) return { kind: "order", order: retried, cancelInvoiceIds };
    }
    // The course changed since: close the old order (and its invoice) rather than re-price it.
    await tx
      .update(orders)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(orders.id, failed.id));
    if (failed.gatewayInvoiceId) cancelInvoiceIds.push(failed.gatewayInvoiceId);
  }

  const [created] = await tx
    .insert(orders)
    .values({
      id: uuidv7(),
      number: generateOrderNumber(),
      buyerId,
      beneficiaryStudentId: beneficiaryId,
      courseId: terms.courseId,
      isSample: terms.isSample,
      ...snapshotValues(reservation, now),
    })
    .returning();
  if (!created) throw new Error("order insert returned no row");
  return { kind: "order", order: created, cancelInvoiceIds };
}

async function reserveWithRetry(reservation: Reservation, now: Date): Promise<Reserved> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db().transaction((tx) => reserveOrder(tx, reservation, now));
    } catch (error) {
      // A lost race on the pending index, or an order-number clash: read again and reuse.
      if (!isUniqueViolation(error) || attempt >= MAX_RESERVE_ATTEMPTS) throw error;
    }
  }
}

/** Best effort: a failure here must not fail the new checkout; a late payment is flagged on confirm. */
async function supersedeInvoice(gateway: PaymentGateway, invoiceId: string): Promise<void> {
  try {
    await gateway.cancelInvoice(invoiceId);
  } catch (error) {
    console.error(
      `[checkout] could not cancel superseded invoice (${error instanceof Error ? error.name : "unknown"})`,
    );
  }
}

/**
 * Starts (or resumes) a purchase. The order row commits first; the gateway invoice is created
 * afterwards and its id stored on the order. If the invoice cannot be created the order stays
 * pending without one and the next attempt reuses it.
 */
export async function startCheckout(
  input: CheckoutInput,
  deps: CheckoutDeps = {},
): Promise<CheckoutResult> {
  const { buyer } = input;
  const guard = await guardCheckout({ userId: buyer.id }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "rate_limited" };

  const [facts] = await db()
    .select({
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, buyer.id))
    .limit(1);
  if (facts?.status !== "active") return { ok: false, reason: "forbidden" };

  const { target, beneficiaryId: requested } = await resolveTarget({
    ...input,
    buyer: { ...buyer, role: facts.role },
  });
  const decision = decideCheckoutActor({
    role: facts.role,
    hasEmail: Boolean(facts.email),
    emailVerified: Boolean(facts.emailVerifiedAt),
    target,
  });
  if (!decision.ok) return { ok: false, reason: decision.reason };
  const beneficiaryId = decision.beneficiary === "self" ? buyer.id : requested;
  if (!beneficiaryId) return { ok: false, reason: "forbidden" };

  const terms = await loadTerms(input.courseId);
  const appMode = deps.appMode ?? serverEnv().APP_MODE;
  if (!terms || (appMode === "live" && terms.isSample)) return { ok: false, reason: "not_found" };

  const now = clock.now();
  const settings = await readPlatformSettings(db());
  const invoiceTtlMs = (settings.invoiceTtlHours ?? DEFAULT_INVOICE_TTL_HOURS) * HOUR_MS;
  if (terms.priceMinor <= 0) return { ok: false, reason: "not_for_sale" };
  if (
    terms.accessKind === "fixed_end" &&
    (!terms.accessEndAt || terms.accessEndAt.getTime() <= now.getTime() + invoiceTtlMs)
  ) {
    return { ok: false, reason: "access_ended" };
  }

  const reserved = await reserveWithRetry(
    {
      buyerId: buyer.id,
      beneficiaryId,
      terms,
      snapshot: {
        currency: settings.currency,
        teacherRateBp: settings.defaultCommissionBp ?? DEFAULT_COMMISSION_BP,
        invoiceTtlMs,
      },
    },
    now,
  );
  if (reserved.kind === "has_access") {
    return { ok: false, reason: "already_has_access", endsAt: reserved.endsAt };
  }
  const { order, cancelInvoiceIds } = reserved;
  const gateway = deps.gateway ?? paymentGateway();
  for (const invoiceId of cancelInvoiceIds) await supersedeInvoice(gateway, invoiceId);

  try {
    const previousInvoiceId = order.gatewayInvoiceId;
    const invoice = await gateway.createInvoice({
      orderId: order.id,
      amountMinor: order.amountMinor,
      currency: order.currency,
      returnUrl: `/orders/${order.number}/return`,
      customerName: buyer.name,
      locale: input.locale ?? "en",
    });
    // Compare-and-set: only replace the invoice this attempt read. A concurrent attempt (double
    // click, second tab) that already swapped it wins; this one cancels its own invoice instead,
    // so an order never has two live invoices.
    const swapped = await db()
      .update(orders)
      .set({ gatewayInvoiceId: invoice.invoiceId, updatedAt: now })
      .where(
        and(
          eq(orders.id, order.id),
          eq(orders.status, "pending"),
          previousInvoiceId === null
            ? isNull(orders.gatewayInvoiceId)
            : eq(orders.gatewayInvoiceId, previousInvoiceId),
        ),
      )
      .returning({ id: orders.id });
    if (swapped.length === 0) {
      await supersedeInvoice(gateway, invoice.invoiceId);
      return { ok: false, reason: "try_again", orderNumber: order.number };
    }
    if (previousInvoiceId) await supersedeInvoice(gateway, previousInvoiceId);
    return {
      ok: true,
      orderId: order.id,
      orderNumber: order.number,
      paymentUrl: invoice.paymentUrl,
    };
  } catch (error) {
    // The error can quote the request; log only its class.
    console.error(
      `[checkout] invoice creation failed (${error instanceof Error ? error.name : "unknown"})`,
    );
    return { ok: false, reason: "try_again", orderNumber: order.number };
  }
}
