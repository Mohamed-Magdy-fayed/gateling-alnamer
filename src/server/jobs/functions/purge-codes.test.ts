import { beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";

const h = vi.hoisted(() => ({ purge: vi.fn(async (_cutoff: Date) => 3) }));
vi.mock("@/server/auth/codes", () => ({ purgeCodesOlderThan: h.purge }));
vi.mock("../client", () => ({ inngest: { createFunction: vi.fn() } }));

describe("handlePurgeCodes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("purges codes consumed or expired more than 24 hours before the injected clock", async () => {
    const now = new Date("2030-03-10T03:00:00Z");
    setClockForTests(now);
    const { handlePurgeCodes, PURGE_AFTER_MS } = await import("./purge-codes");
    expect(PURGE_AFTER_MS).toBe(24 * 60 * 60 * 1000);
    await expect(handlePurgeCodes()).resolves.toBe(3);
    expect(h.purge).toHaveBeenCalledWith(new Date("2030-03-09T03:00:00Z"));
    setClockForTests(null);
  });
});

describe("purge-codes registration", () => {
  it("is a daily cron function listed with the others", async () => {
    const { PURGE_CRON } = await import("./purge-codes");
    expect(PURGE_CRON).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});
