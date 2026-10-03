"use server";

import { redirect } from "next/navigation";
import { assertDevRoute } from "@/server/dev-guard";
import { formatOrderNumber } from "@/server/orders/number";
import { getHostedInvoice, settleHostedInvoice } from "@/server/payments/mock";
import { isMockInvoiceId } from "./invoice-id";

/**
 * The mock gateway's hosted page buttons. Server actions skip the `/dev` layout, so each one runs
 * the dev guard itself. Only a pending invoice moves; anything else just shows the page again.
 */
async function settle(invoiceId: string, outcome: "paid" | "failed"): Promise<never> {
  assertDevRoute();
  if (!isMockInvoiceId(invoiceId)) redirect("/");
  const moved = await settleHostedInvoice(invoiceId, outcome);
  const invoice = moved ? await getHostedInvoice(invoiceId) : null;
  if (!invoice?.orderNumber) redirect(`/dev/pay/${invoiceId}`);
  redirect(
    `/orders/${formatOrderNumber(invoice.orderNumber)}/return?invoice=${encodeURIComponent(invoiceId)}`,
  );
}

export async function payInvoiceAction(invoiceId: string): Promise<never> {
  return settle(invoiceId, "paid");
}

export async function failInvoiceAction(invoiceId: string): Promise<never> {
  return settle(invoiceId, "failed");
}
