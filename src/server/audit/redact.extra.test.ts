import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact (deep)", () => {
  it("masks emails in arrays under email-like keys", () => {
    expect(redact({ emails: ["a@b.co", "cc@dd.org"], to: ["x@y.com"] })).toEqual({
      emails: ["a***@b***.co", "c***@d***.org"],
      to: ["x***@y***.com"],
    });
  });

  it("masks nested objects under email-like keys", () => {
    expect(redact({ recipient: { address: "bob@mail.io", name: "Bob" } })).toEqual({
      recipient: { address: "b***@m***.io", name: "Bob" },
    });
  });

  it("masks username only when it looks like an email", () => {
    expect(redact({ username: "bob@mail.io" })).toEqual({ username: "b***@m***.io" });
    expect(redact({ username: "bob" })).toEqual({ username: "bob" });
  });

  it("masks any email-looking string under any key", () => {
    expect(redact({ note: "bob@mail.io", list: ["al@x.com", "plain"] })).toEqual({
      note: "b***@m***.io",
      list: ["a***@x***.com", "plain"],
    });
  });

  it("reduces every string under an iban key at any depth", () => {
    expect(redact({ iban: { a: "1234567890", b: ["AAAA1111", "BBBB2222"] } })).toEqual({
      iban: { a: "7890", b: ["1111", "2222"] },
    });
  });

  it("still removes secret keys inside email contexts", () => {
    expect(redact({ emails: [{ token: "t", v: "a@b.co" }] })).toEqual({
      emails: [{ v: "a***@b***.co" }],
    });
  });
});
