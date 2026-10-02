import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { AppError } from "@/server/errors";
import { publicProcedure, router } from "./trpc";

const testRouter = router({
  plain: publicProcedure.query(() => {
    throw new Error("secret db detail postgres://u:p@host");
  }),
  app: publicProcedure.query(() => {
    throw new AppError("not_found");
  }),
});

async function call(path: string) {
  const onError = vi.fn();
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}`),
    router: testRouter,
    createContext: async () => ({ user: null }),
    onError,
  });
  const text = await res.text();
  return { res, text, onError };
}

describe("tRPC error formatting", () => {
  it("hides the message of a plain Error behind a generic INTERNAL_SERVER_ERROR", async () => {
    const { res, text } = await call("plain");
    expect(res.status).toBe(500);
    expect(text).toContain("INTERNAL_SERVER_ERROR");
    expect(text).not.toContain("secret db detail");
    expect(text).not.toContain("postgres://");
  });

  it("keeps the mapped tRPC code for an AppError", async () => {
    const { res, text } = await call("app");
    expect(res.status).toBe(404);
    expect(text).toContain("NOT_FOUND");
  });

  it("passes the real error to onError", async () => {
    const { onError } = await call("plain");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].error.cause)).toContain("secret db detail");
  });
});
