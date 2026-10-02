import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ expire: vi.fn(async () => ["d1", "d2"]) }));
vi.mock("@/server/devices/service", () => ({ expireDevices: h.expire }));
vi.mock("../client", () => ({ inngest: { createFunction: vi.fn() } }));

describe("handleExpireDevices", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to expireDevices and returns how many devices expired", async () => {
    const { handleExpireDevices } = await import("./expire-devices");
    await expect(handleExpireDevices()).resolves.toBe(2);
    expect(h.expire).toHaveBeenCalledTimes(1);
  });
});

describe("expire-devices registration", () => {
  it("runs daily at 03:00 Africa/Cairo", async () => {
    const { EXPIRE_DEVICES_CRON } = await import("./expire-devices");
    expect(EXPIRE_DEVICES_CRON).toBe("TZ=Africa/Cairo 0 3 * * *");
  });
});
