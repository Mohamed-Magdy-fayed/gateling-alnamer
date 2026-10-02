import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ BASE_URL: "https://alnamer.example" }) }));

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { publicProcedure, router } from "./trpc";

const testRouter = router({
  read: publicProcedure.query(() => "read-ok"),
  write: publicProcedure.mutation(() => "write-ok"),
});

async function call(path: string, method: "GET" | "POST", headers: Record<string, string>) {
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://app.local:3400/api/trpc/${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "POST" ? JSON.stringify({ json: null }) : undefined,
    }),
    router: testRouter,
    createContext: async ({ req }) => ({ user: null, headers: req.headers }),
  });
  return { status: res.status, text: await res.text() };
}

describe("tRPC mutation Origin check", () => {
  it("rejects a mutation without an Origin header", async () => {
    const { status, text } = await call("write", "POST", { host: "app.local:3400" });
    expect(status).toBe(403);
    expect(text).toContain("FORBIDDEN");
  });

  it("rejects a mutation from a foreign Origin", async () => {
    const { status } = await call("write", "POST", {
      host: "app.local:3400",
      origin: "https://evil.example",
    });
    expect(status).toBe(403);
  });

  it("allows a same-origin mutation", async () => {
    const { status, text } = await call("write", "POST", {
      host: "app.local:3400",
      origin: "http://app.local:3400",
    });
    expect(status).toBe(200);
    expect(text).toContain("write-ok");
  });

  it("allows an Origin matching the BASE_URL host", async () => {
    const { status } = await call("write", "POST", {
      host: "app.local:3400",
      origin: "https://alnamer.example",
    });
    expect(status).toBe(200);
  });

  it("rejects a malformed Origin", async () => {
    const { status } = await call("write", "POST", { host: "app.local:3400", origin: "null" });
    expect(status).toBe(403);
  });

  it("leaves queries alone", async () => {
    const { status } = await call("read", "GET", {});
    expect(status).toBe(200);
  });
});
