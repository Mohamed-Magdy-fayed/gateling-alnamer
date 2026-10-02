import { describe, expect, it } from "vitest";
import { APP_ERRORS, AppError } from "./errors";

describe("AppError", () => {
  it("carries code, i18n key, tRPC code and log level from the catalogue", () => {
    const err = new AppError("not_found");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("not_found");
    expect(err.i18nKey).toBe(APP_ERRORS.not_found.i18nKey);
    expect(err.trpcCode).toBe("NOT_FOUND");
    expect(err.logLevel).toBe(APP_ERRORS.not_found.logLevel);
  });

  it("maps the generic codes", () => {
    expect(new AppError("forbidden").trpcCode).toBe("FORBIDDEN");
    expect(new AppError("rate_limited").trpcCode).toBe("TOO_MANY_REQUESTS");
    expect(new AppError("invalid_input").trpcCode).toBe("BAD_REQUEST");
    expect(new AppError("internal").trpcCode).toBe("INTERNAL_SERVER_ERROR");
  });

  it("keeps the cause", () => {
    const cause = new Error("db down");
    expect(new AppError("internal", { cause }).cause).toBe(cause);
  });
});
