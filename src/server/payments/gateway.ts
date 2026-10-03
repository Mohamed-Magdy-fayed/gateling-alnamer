import "server-only";
import { serverEnv } from "@/server/env";
import { createMockGateway } from "./mock";

export { InvoiceNotFoundError } from "./errors";

export type CreateInvoiceInput = {
  orderId: string;
  amountMinor: number;
  currency: string;
  returnUrl: string;
  customerName: string;
  locale: string;
};

export type PaymentStatus = {
  status: "pending" | "paid" | "failed" | "expired";
  /** The order id the invoice was created for. */
  customerReference: string;
  amountMinor: number;
  currency: string;
  paymentId?: string;
  feeMinor?: number;
};

export interface PaymentGateway {
  createInvoice(input: CreateInvoiceInput): Promise<{ invoiceId: string; paymentUrl: string }>;
  getPaymentStatus(invoiceId: string): Promise<PaymentStatus>;
}

/** The gateway selected by `PAYMENT_PROVIDER`. Only the mock exists until P3. */
export function paymentGateway(
  provider: "mock" | "myfatoorah" = serverEnv().providers.payment,
): PaymentGateway {
  if (provider === "mock") return createMockGateway();
  throw new Error("PAYMENT_PROVIDER=myfatoorah is not implemented (P3)");
}
