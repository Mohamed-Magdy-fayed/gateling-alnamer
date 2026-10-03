/** Thrown by `getPaymentStatus` when the gateway has no such invoice. */
export class InvoiceNotFoundError extends Error {
  constructor() {
    super("invoice not found");
    this.name = "InvoiceNotFoundError";
  }
}
