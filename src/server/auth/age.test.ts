import { describe, expect, it } from "vitest";
import { cairoToday, isUnder18, parseIsoDate } from "./age";

describe("cairoToday", () => {
  it("uses the Africa/Cairo calendar date, not UTC", () => {
    // 22:30 UTC on 30 Jan is already 31 Jan in Cairo (UTC+2 in winter).
    expect(cairoToday(new Date("2026-01-30T22:30:00Z"))).toBe("2026-01-31");
    expect(cairoToday(new Date("2026-01-30T12:00:00Z"))).toBe("2026-01-30");
  });
});

describe("parseIsoDate", () => {
  it("accepts real dates only", () => {
    expect(parseIsoDate("2010-02-28")).toEqual({ year: 2010, month: 2, day: 28 });
    expect(parseIsoDate("2010-02-30")).toBeNull();
    expect(parseIsoDate("2011-13-01")).toBeNull();
    expect(parseIsoDate("nope")).toBeNull();
    expect(parseIsoDate("2024-02-29")).not.toBeNull();
    expect(parseIsoDate("2023-02-29")).toBeNull();
  });
});

describe("isUnder18", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  it("is true until the 18th birthday and false on it", () => {
    expect(isUnder18("2008-10-03", now)).toBe(true);
    expect(isUnder18("2008-10-02", now)).toBe(false);
    expect(isUnder18("2000-01-01", now)).toBe(false);
    expect(isUnder18("2015-05-05", now)).toBe(true);
  });
  it("counts the Cairo date at the sign-up instant", () => {
    // Birthday 2008-10-03: at 22:30Z on 2 Oct it is already 3 Oct in Cairo, so 18.
    expect(isUnder18("2008-10-03", new Date("2026-10-02T22:30:00Z"))).toBe(false);
  });
});
