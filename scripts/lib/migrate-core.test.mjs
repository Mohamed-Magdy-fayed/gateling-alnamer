import { describe, expect, it, vi } from "vitest";
import { pickMigrationUrl, withMigrationLock } from "./migrate-core.mjs";

describe("pickMigrationUrl", () => {
  it("prefers DATABASE_URL_UNPOOLED", () => {
    expect(pickMigrationUrl({ DATABASE_URL: "pooled", DATABASE_URL_UNPOOLED: "direct" })).toBe(
      "direct",
    );
  });
  it("falls back to DATABASE_URL when the direct url is unset or blank", () => {
    expect(pickMigrationUrl({ DATABASE_URL: "pooled" })).toBe("pooled");
    expect(pickMigrationUrl({ DATABASE_URL: "pooled", DATABASE_URL_UNPOOLED: "" })).toBe("pooled");
  });
  it("returns undefined when neither is set", () => {
    expect(pickMigrationUrl({})).toBeUndefined();
  });
});

describe("withMigrationLock", () => {
  const make = (overrides = {}) => ({
    lock: vi.fn(async () => {}),
    unlock: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    work: vi.fn(async () => "done"),
    log: vi.fn(),
    ...overrides,
  });

  it("returns the work result and releases", async () => {
    const o = make();
    await expect(withMigrationLock(o)).resolves.toBe("done");
    expect(o.unlock).toHaveBeenCalledOnce();
    expect(o.end).toHaveBeenCalledOnce();
  });

  it("keeps the migrate error when the unlock also fails, and logs the unlock failure", async () => {
    const o = make({
      work: vi.fn(async () => {
        throw new Error("migration failed");
      }),
      unlock: vi.fn(async () => {
        throw new Error("connection terminated");
      }),
    });
    await expect(withMigrationLock(o)).rejects.toThrow("migration failed");
    expect(o.log).toHaveBeenCalledWith(expect.stringContaining("connection terminated"));
    expect(o.end).toHaveBeenCalledOnce();
  });

  it("does not fail a successful migration because the unlock failed", async () => {
    const o = make({
      unlock: vi.fn(async () => {
        throw new Error("gone");
      }),
    });
    await expect(withMigrationLock(o)).resolves.toBe("done");
    expect(o.log).toHaveBeenCalledOnce();
  });
});
