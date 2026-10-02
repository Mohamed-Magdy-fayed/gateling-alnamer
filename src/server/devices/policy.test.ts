import { describe, expect, it } from "vitest";
import { decide, nextSelfRemovalAt, SELF_REMOVAL_INTERVAL_MS } from "./policy";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const active = (...keys: string[]) => keys.map((deviceKey) => ({ deviceKey }));

describe("decide", () => {
  it("registers a new device under the limit", () => {
    expect(decide({ activeDevices: active(A), deviceKey: B, limit: 2, mode: "strict" })).toBe(
      "register",
    );
  });

  it("blocks the third device in strict mode", () => {
    expect(decide({ activeDevices: active(A, B), deviceKey: C, limit: 2, mode: "strict" })).toBe(
      "block",
    );
  });

  it("allows but flags the third device in soft mode", () => {
    expect(decide({ activeDevices: active(A, B), deviceKey: C, limit: 2, mode: "soft" })).toBe(
      "registerOver",
    );
  });

  it("never counts a known key twice, even at or over the limit", () => {
    expect(decide({ activeDevices: active(A, B), deviceKey: A, limit: 2, mode: "strict" })).toBe(
      "known",
    );
    expect(decide({ activeDevices: active(A, B, C), deviceKey: A, limit: 2, mode: "strict" })).toBe(
      "known",
    );
  });

  it("registers the first device on an empty account", () => {
    expect(decide({ activeDevices: [], deviceKey: A, limit: 1, mode: "strict" })).toBe("register");
  });
});

describe("nextSelfRemovalAt", () => {
  const last = new Date("2030-03-01T09:00:00.000Z");
  const removals = [
    { kind: "self" as const, createdAt: new Date("2030-02-01T00:00:00.000Z") },
    { kind: "self" as const, createdAt: last },
    { kind: "admin" as const, createdAt: new Date("2030-03-02T00:00:00.000Z") },
  ];

  it("is null with no self removals (admin removals do not count)", () => {
    const now = new Date("2030-03-03T00:00:00.000Z");
    expect(nextSelfRemovalAt([], now)).toBeNull();
    expect(nextSelfRemovalAt([{ kind: "admin", createdAt: last }], now)).toBeNull();
  });

  it("is blocked 6 days 23 hours after the last self removal", () => {
    const now = new Date(last.getTime() + SELF_REMOVAL_INTERVAL_MS - 60 * 60 * 1000);
    expect(nextSelfRemovalAt(removals, now)?.getTime()).toBe(
      last.getTime() + SELF_REMOVAL_INTERVAL_MS,
    );
  });

  it("is allowed again after 7 days", () => {
    const now = new Date(last.getTime() + SELF_REMOVAL_INTERVAL_MS);
    expect(nextSelfRemovalAt(removals, now)).toBeNull();
  });
});
