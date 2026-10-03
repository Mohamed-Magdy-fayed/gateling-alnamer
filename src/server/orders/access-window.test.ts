import { describe, expect, it } from "vitest";
import { computeAccessWindow } from "./access-window";

const PAID_AT = new Date("2030-05-01T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("computeAccessWindow", () => {
  it("fixed end: from payment to the course end", () => {
    const endAt = new Date("2030-09-01T00:00:00.000Z");
    expect(computeAccessWindow(PAID_AT, { kind: "fixed_end", endAt })).toEqual({
      startsAt: PAID_AT,
      endsAt: endAt,
    });
  });

  it("fixed end that has passed (or is now) grants nothing", () => {
    expect(computeAccessWindow(PAID_AT, { kind: "fixed_end", endAt: PAID_AT })).toBeNull();
    expect(
      computeAccessWindow(PAID_AT, { kind: "fixed_end", endAt: new Date(PAID_AT.getTime() - 1) }),
    ).toBeNull();
  });

  it("duration: payment time plus the days", () => {
    expect(computeAccessWindow(PAID_AT, { kind: "duration_days", days: 30 })).toEqual({
      startsAt: PAID_AT,
      endsAt: new Date(PAID_AT.getTime() + 30 * DAY_MS),
    });
  });
});
