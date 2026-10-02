import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/server/redis", () => ({ getRedis: () => ({ ping: async () => "PONG" }) }));
vi.mock("@/server/db", () => ({
  db: () => ({
    execute: async () => {
      throw new Error("db down");
    },
  }),
}));

describe("GET /api/health with the database down", () => {
  it("returns 503 degraded", async () => {
    process.env.APP_MODE = "demo";
    process.env.BASE_URL = "http://localhost:3400";
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded" });
  });
});
