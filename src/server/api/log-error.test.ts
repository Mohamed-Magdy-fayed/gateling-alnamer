import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ BASE_URL: "https://alnamer.example" }) }));

import { logTrpcError } from "./trpc";

/** A driver error shaped like Drizzle's: the message and params quote the row, the cause has the pg code. */
class DrizzleQueryError extends Error {
  readonly params: unknown[];
  constructor(params: unknown[], cause: unknown) {
    super(`Failed query: insert into users (email) values ($1)\nparams: ${params.join(",")}`, {
      cause,
    });
    this.name = "DrizzleQueryError";
    this.params = params;
  }
}

afterEach(() => vi.restoreAllMocks());

describe("logTrpcError", () => {
  it("logs the cause's name and the pg code, never the message or the params", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pg = Object.assign(new Error('duplicate key value violates "secret@example.test"'), {
      code: "23505",
    });
    const cause = new DrizzleQueryError(["secret@example.test", "hunter2-value"], pg);
    logTrpcError({
      path: "auth.signUp",
      error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0] ?? [];
    expect(args.every((arg) => typeof arg === "string")).toBe(true);
    const line = args.join(" ");
    expect(line).toContain("auth.signUp");
    expect(line).toContain("DrizzleQueryError");
    expect(line).toContain("23505");
    expect(line).not.toContain("secret@example.test");
    expect(line).not.toContain("hunter2-value");
    expect(line).not.toContain("Failed query");
  });

  it("logs just the name when there is no pg code", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logTrpcError({
      path: "x.y",
      error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: new TypeError("leaky detail") }),
    });
    const line = (spy.mock.calls[0] ?? []).join(" ");
    expect(line).toContain("TypeError");
    expect(line).not.toContain("leaky detail");
  });
});
