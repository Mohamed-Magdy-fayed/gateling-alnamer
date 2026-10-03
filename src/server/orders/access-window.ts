const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessTerms =
  | { kind: "fixed_end"; endAt: Date }
  | { kind: "duration_days"; days: number };

export type AccessWindow = { startsAt: Date; endsAt: Date };

/**
 * The access an order buys, starting at payment. Null when a fixed-end course had already ended at
 * payment time: nothing is granted (the order is flagged for refund instead).
 */
export function computeAccessWindow(paidAt: Date, terms: AccessTerms): AccessWindow | null {
  if (terms.kind === "fixed_end") {
    return terms.endAt.getTime() > paidAt.getTime()
      ? { startsAt: paidAt, endsAt: terms.endAt }
      : null;
  }
  return { startsAt: paidAt, endsAt: new Date(paidAt.getTime() + terms.days * DAY_MS) };
}
