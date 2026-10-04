import { describe, expect, it } from "vitest";
import { isForeignKeyViolation, isUniqueViolation } from "./errors";

describe("isUniqueViolation", () => {
  it("finds 23505 on the error or anywhere down its cause chain", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("wrapped", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("other"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("isForeignKeyViolation", () => {
  it("finds 23503 on the error or anywhere down its cause chain", () => {
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
    expect(isForeignKeyViolation(new Error("wrapped", { cause: { code: "23503" } }))).toBe(true);
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
  });
});
