import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const getRedis = vi.fn();
vi.mock("@/server/auth/session", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/server/redis", () => ({ getRedis: () => getRedis() }));

const okRedis = { ping: async () => "PONG" };
const brokenRedis = {
  ping: async () => {
    throw new Error("down");
  },
};

beforeEach(() => {
  process.env.APP_MODE = "demo";
  process.env.BASE_URL = "http://localhost:3400";
  getCurrentUser.mockResolvedValue(null);
  getRedis.mockReturnValue(okRedis);
});
afterEach(() => vi.clearAllMocks());

async function call() {
  const { GET } = await import("./route");
  const res = await GET();
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/health", () => {
  it("returns 200 ok publicly with db and redis up", async () => {
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ status: "ok" });
  });

  it("returns 503 degraded when the redis check throws", async () => {
    getRedis.mockReturnValue(brokenRedis);
    const { res, body } = await call();
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "degraded" });
  });

  it("does not expose details to a non-admin user", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", name: "n", email: "e@x.com", role: "student" });
    const { body } = await call();
    expect(body).toEqual({ status: "ok" });
  });

  it("adds details for an admin", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", name: "n", email: "e@x.com", role: "admin" });
    const { body } = await call();
    expect(body).toMatchObject({
      status: "ok",
      checks: { db: "ok", redis: "ok" },
      appMode: "demo",
    });
    expect(typeof body.jobsMode).toBe("string");
  });
});

describe("GET /api/health bounded checks", () => {
  it("returns 503 degraded when the redis ping does not answer within 1s", async () => {
    getRedis.mockReturnValue({ ping: () => new Promise(() => {}) });
    const started = Date.now();
    const { res, body } = await call();
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "degraded" });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
