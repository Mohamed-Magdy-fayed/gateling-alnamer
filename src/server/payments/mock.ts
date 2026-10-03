import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { mockGatewayInvoices, type mockInvoiceStatus } from "@/server/db/schema";
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
