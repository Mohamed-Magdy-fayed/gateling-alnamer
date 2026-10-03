import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { accountErrorState } from "./error-state";

function failure(message: string, code: string) {
  return TRPCClientError.from({
    error: { message, code: -32600, data: { code, httpStatus: 400 } },
  } as never);
}

describe("accountErrorState", () => {
  it("reads a limit as a warning", () => {
    const state = accountErrorState(failure("rate_limited", "TOO_MANY_REQUESTS"), en.auth);
    expect(state).toMatchObject({ status: "error", tone: "warning" });
    expect(state.message).toBe(en.auth.states.rateLimited);
  });

  it("reads a wrong or expired code as the code message", () => {
    const state = accountErrorState(failure("auth.states.codeInvalid", "BAD_REQUEST"), en.auth);
    expect(state.message).toBe(en.auth.states.codeInvalid);
  });

  it("reads anything else, even a non-tRPC error, as check the details", () => {
    expect(accountErrorState(failure("auth.errors.invalid", "BAD_REQUEST"), en.auth).message).toBe(
      en.auth.errors.invalid,
    );
    expect(accountErrorState(new Error("boom"), en.auth).message).toBe(en.auth.errors.invalid);
  });
});
