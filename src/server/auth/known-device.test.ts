import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEEN_DID_TTL_SEC } from "@/server/config/policy";
import { FakeRedis } from "../../../test/fake-redis";
import { deriveKey } from "./keys";
import { isKnownDevice, markDeviceSeen } from "./known-device";

const KEY = deriveKey("t".repeat(40), "rl");
const ID = "0b8f7d52-5f0e-4f7b-9d34-0a1b2c3d4e5f";
let redis: FakeRedis;
const base = () => ({ redis: redis as never, key: KEY, deviceExists: async () => false });

beforeEach(() => {
  redis = new FakeRedis();
});

describe("known device ids", () => {
  it("an id nobody has seen is unknown", async () => {
    expect(await isKnownDevice(ID, base())).toBe(false);
  });

  it("an id in devices for any user is known", async () => {
    expect(await isKnownDevice(ID, { ...base(), deviceExists: async () => true })).toBe(true);
  });

  it("an id marked seen after a sign-in is known for 30 days, under a keyed hash", async () => {
    await markDeviceSeen(ID, base());
    expect(await isKnownDevice(ID, base())).toBe(true);
    const [stored] = [...redis.values.keys()];
    expect(stored).toBeDefined();
    expect(stored).not.toContain(ID);
    expect(redis.ttls.get(stored ?? "")).toBe(SEEN_DID_TTL_SEC);
    expect(SEEN_DID_TTL_SEC).toBe(30 * 24 * 60 * 60);
  });

  it("Redis down: unknown (the IP pair stands in), and marking never throws", async () => {
    redis.failing = true;
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(markDeviceSeen(ID, base())).resolves.toBeUndefined();
    expect(await isKnownDevice(ID, base())).toBe(false);
    warn.mockRestore();
  });

  it("without Redis only the devices table counts", async () => {
    const none = { redis: null, key: KEY, deviceExists: async () => false };
    await markDeviceSeen(ID, none);
    expect(await isKnownDevice(ID, none)).toBe(false);
    expect(await isKnownDevice(ID, { ...none, deviceExists: async () => true })).toBe(true);
  });
});
