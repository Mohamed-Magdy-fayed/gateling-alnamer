import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/auth/page-guard";
import { confirmPayment } from "@/server/orders/confirm";
import { formatOrderNumber } from "@/server/orders/number";
import { getOrderViewForParty } from "@/server/orders/views";

const MAX_INVOICE_ID = 64;

/**
 * Where the payment page sends the buyer back. It syncs the order with the gateway (confirmPayment
 * only applies what the gateway reports and is idempotent, so the request itself grants nothing)
 * and then shows the order. A page rather than a route handler, so a redirect from the hosted page
 * lands with the final URL. Nothing runs for an order the caller neither bought nor benefits from.
 * Any invoice id is passed on: confirmPayment finds the order through the gateway's own reference,
 * so an older invoice of this order paid late is still applied (a gateway Paid is never ignored).
 * No same-site check: a real gateway sends the buyer here cross-site.
 */
export default async function OrderReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ invoice?: string }>;
}) {
  const { number } = await params;
  const { invoice } = await searchParams;
  const user = await requirePageUser(`/orders/${encodeURIComponent(number)}`);
  const order = await getOrderViewForParty(user.id, number);
  if (!order) redirect("/dashboard");
  if (invoice && invoice.length <= MAX_INVOICE_ID) await confirmPayment(invoice);
  redirect(`/orders/${formatOrderNumber(order.number)}`);
}
