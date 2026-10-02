import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";

vi.mock("@/server/db", () => ({ db: () => ({}) }));

const { signUpUser } = await import("./sign-up");

const EMAIL = "private.person@example.test";
const NOW = new Date("2026-10-02T10:00:00Z");

/** A connection whose insert fails like Postgres does: the message quotes the row, email included. */
function failingConn(pgCode: string) {
  const error = Object.assign(
    new Error(`Failed query: insert into "users" ... params: Test Person,${EMAIL}`),
    { code: pgCode },
  );
  return {
    query: { users: { findFirst: async () => undefined } },
    transaction: async () => {
      throw new Error("Failed query", { cause: error });
    },
  } as unknown as Parameters<typeof signUpUser>[2];
}

const input = {
  name: "Test Person",
  email: EMAIL,
  password: "A-good-pass-1",
  role: "student",
  date_of_birth: "2000-01-01",
};

afterEach(() => vi.restoreAllMocks());

describe("signUpUser failures", () => {
  it("logs only a fixed prefix and the PG code, and throws an AppError without the email", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    const thrown = await signUpUser(input, { locale: "en", now: NOW }, failingConn("40001")).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(AppError);
    const appError = thrown as AppError;
    expect(appError.code).toBe("internal");
    expect(appError.message).not.toContain(EMAIL);
    expect(String(appError.cause ?? "")).not.toContain(EMAIL);
    expect(logged.join("\n")).toContain("[auth] sign-up failed");
    expect(logged.join("\n")).toContain("40001");
    expect(logged.join("\n")).not.toContain(EMAIL);
  });
});
