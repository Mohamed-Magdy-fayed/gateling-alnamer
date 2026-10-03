import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { mockGatewayInvoices, type mockInvoiceStatus, orders } from "@/server/db/schema";
import { InvoiceNotFoundError } from "./errors";
import type { PaymentGateway, PaymentStatus } from "./gateway";

type MockStatus = (typeof mockInvoiceStatus.enumValues)[number];

/** Demo gateway fee: 2.5%, in integer minor units (floor). */
const MOCK_FEE_BP = 250n;
const BP_DENOMINATOR = 10_000n;

function feeFor(amountMinor: number): number {
  return Number((BigInt(amountMinor) * MOCK_FEE_BP) / BP_DENOMINATOR);
}

/**
 * The mock gateway. State lives in `mock_gateway_invoices`, so the hosted `/dev/pay` page and the
 * status query share it. `returnUrl` is not stored: the hosted page redirects to the order's own
 * return route, which it derives from the order number.
 */
export function createMockGateway(): PaymentGateway {
  return {
    async createInvoice(input) {
      const invoiceId = `MOCK-${randomBytes(8).toString("hex").toUpperCase()}`;
      await db().insert(mockGatewayInvoices).values({
        id: invoiceId,
        customerReference: input.orderId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      });
      return { invoiceId, paymentUrl: `/dev/pay/${invoiceId}` };
    },

    async cancelInvoice(invoiceId) {
      await db()
        .update(mockGatewayInvoices)
        .set({ status: "expired" })
        .where(
          and(eq(mockGatewayInvoices.id, invoiceId), eq(mockGatewayInvoices.status, "pending")),
        );
    },

    async getPaymentStatus(invoiceId): Promise<PaymentStatus> {
      const [row] = await db()
        .select()
        .from(mockGatewayInvoices)
        .where(eq(mockGatewayInvoices.id, invoiceId))
        .limit(1);
      if (!row) throw new InvoiceNotFoundError();
      return {
        status: row.status,
        customerReference: row.customerReference,
        amountMinor: row.amountMinor,
        currency: row.currency,
        ...(row.status === "paid" && row.paymentId
          ? { paymentId: row.paymentId, feeMinor: feeFor(row.amountMinor) }
          : {}),
      };
    },
  };
}

/** The "Pay" / "Fail" buttons of the hosted page, and test helpers. Returns false for an unknown invoice. */
export async function setMockInvoiceStatus(
  invoiceId: string,
  status: MockStatus,
): Promise<boolean> {
  const paid = status === "paid";
  const rows = await db()
    .update(mockGatewayInvoices)
    .set({
      status,
      paidAt: paid ? clock.now() : null,
      paymentId: paid ? `MOCKPAY-${randomUUID()}` : null,
    })
    .where(eq(mockGatewayInvoices.id, invoiceId))
    .returning({ id: mockGatewayInvoices.id });
  return rows.length > 0;
}

export type HostedInvoice = {
  id: string;
  status: MockStatus;
  amountMinor: number;
  currency: string;
  /** The order the invoice belongs to (its number, without the dash), for the return redirect. */
  orderNumber: string | null;
};

/** What the hosted `/dev/pay` page shows. Null for an unknown invoice. */
export async function getHostedInvoice(invoiceId: string): Promise<HostedInvoice | null> {
  const [row] = await db()
    .select({
      id: mockGatewayInvoices.id,
      status: mockGatewayInvoices.status,
      amountMinor: mockGatewayInvoices.amountMinor,
      currency: mockGatewayInvoices.currency,
      orderNumber: orders.number,
    })
    .from(mockGatewayInvoices)
    .leftJoin(orders, sql`${orders.id}::text = ${mockGatewayInvoices.customerReference}`)
    .where(eq(mockGatewayInvoices.id, invoiceId))
    .limit(1);
  return row ?? null;
}

/**
 * The hosted page's "Pay" / "Fail": only a still-pending invoice moves, so a superseded (expired)
 * or settled invoice cannot be paid from the page. Returns whether it moved.
 */
export async function settleHostedInvoice(
  invoiceId: string,
  outcome: "paid" | "failed",
): Promise<boolean> {
  const paid = outcome === "paid";
  const rows = await db()
    .update(mockGatewayInvoices)
    .set({
      status: outcome,
      paidAt: paid ? clock.now() : null,
      paymentId: paid ? `MOCKPAY-${randomUUID()}` : null,
    })
    .where(and(eq(mockGatewayInvoices.id, invoiceId), eq(mockGatewayInvoices.status, "pending")))
    .returning({ id: mockGatewayInvoices.id });
  return rows.length > 0;
}
