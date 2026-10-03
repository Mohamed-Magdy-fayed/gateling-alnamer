/** Mock invoice ids are `MOCK-` plus 16 upper-case hex characters (see the mock gateway). */
export function isMockInvoiceId(value: string): boolean {
  return /^MOCK-[0-9A-F]{16}$/.test(value);
}
