import { describe, expect, it } from "vitest";
import { PENDING_RESET_TTL_MS } from "@/server/config/policy";
import {
  newResetNonce,
  parsePendingReset,
  resetRequesterHash,
  signPendingReset,
} from "./pending-reset";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-10-02T10:00:00Z");
const pending = { email: "who@example.test", issuedAt: NOW.getTime(), nonce: "n-1" };

describe("pending reset cookie", () => {
  it("round-trips the email and issue time", () => {
    expect(parsePendingReset(signPendingReset(pending, SECRET), SECRET, NOW)).toEqual(pending);
  });

  it("rejects a tampered payload, another secret and garbage", () => {
    const value = signPendingReset(pending, SECRET);
    const forged = signPendingReset({ ...pending, email: "victim@example.test" }, SECRET);
    const [payload] = forged.split(".");
    const [, mac] = value.split(".");
    expect(parsePendingReset(`${payload}.${mac}`, SECRET, NOW)).toBeNull();
    expect(parsePendingReset(value, "x".repeat(40), NOW)).toBeNull();
    expect(parsePendingReset("nonsense", SECRET, NOW)).toBeNull();
    expect(parsePendingReset(undefined, SECRET, NOW)).toBeNull();
  });

  it("expires after the pending TTL", () => {
    const value = signPendingReset(pending, SECRET);
    const late = new Date(NOW.getTime() + PENDING_RESET_TTL_MS + 1);
    expect(parsePendingReset(value, SECRET, late)).toBeNull();
  });

  it("refuses a cookie without a requester nonce (issued before A8)", () => {
    const old = signPendingReset({ ...pending, nonce: "" }, SECRET);
    expect(parsePendingReset(old, SECRET, NOW)).toBeNull();
  });

  it("nonces are random and only their keyed hash is stored", () => {
    const key = Buffer.alloc(32, 7);
    const a = newResetNonce();
    expect(a).not.toBe(newResetNonce());
    expect(resetRequesterHash(a, key)).toBe(resetRequesterHash(a, key));
    expect(resetRequesterHash(a, key)).not.toContain(a);
  });

  it("does not put the email in the clear", () => {
    expect(signPendingReset(pending, SECRET)).not.toContain("who@example.test");
  });
});
