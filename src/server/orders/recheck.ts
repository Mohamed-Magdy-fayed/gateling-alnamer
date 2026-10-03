import "server-only";
import { type AbuseDeps, guardOrderRecheck } from "@/server/auth/abuse";
import { type ConfirmDeps, confirmPayment } from "./confirm";
import { getOrderViewForParty, type OrderView } from "./views";

/** Statuses a gateway `paid` can still change; a settled order needs no gateway call. */
const RECHECKABLE = new Set(["pending", "failed", "expired", "cancelled"]);

export type RecheckResult =
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "ok"; order: OrderView };

/** "Check again" on the order page: re-runs `confirmPayment` for the order's latest invoice. */
export async function recheckOrder(
  userId: string,
  number: string,
  deps: AbuseDeps & ConfirmDeps = {},
): Promise<RecheckResult> {
  const order = await getOrderViewForParty(userId, number);
  if (!order) return { kind: "not_found" };
  const guard = await guardOrderRecheck({ userId }, deps);
  if (!("ok" in guard)) return { kind: "rate_limited" };
  if (!order.gatewayInvoiceId || !RECHECKABLE.has(order.status)) return { kind: "ok", order };
  await confirmPayment(order.gatewayInvoiceId, deps);
  const refreshed = await getOrderViewForParty(userId, number);
  return refreshed ? { kind: "ok", order: refreshed } : { kind: "not_found" };
}
