import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));

import { appRouter } from "./root";
import { createCallerFactory } from "./trpc";

describe("health.ping", () => {
  it("returns ok and a timestamp", async () => {
    const caller = createCallerFactory(appRouter)({ user: null });
    const result = await caller.health.ping();
    expect(result.ok).toBe(true);
    expect(result.at).toBeInstanceOf(Date);
  });
});
