import { describe, expect, it } from "vitest";
import { formatInviteInput, reformatInviteWithCaret } from "./invite-code";

describe("formatInviteInput", () => {
  it("upper-cases, maps Arabic-Indic digits and adds the dash", () => {
    expect(formatInviteInput("abcd ٢٣45")).toBe("ABCD-2345");
  });
});

describe("reformatInviteWithCaret", () => {
  it("keeps the caret after a letter typed in the middle", () => {
    expect(reformatInviteWithCaret("ABXCD-2345", 3)).toEqual({ value: "ABXC-D234", caret: 3 });
  });

  it("moves the caret past the inserted dash when typing the fifth character", () => {
    expect(reformatInviteWithCaret("abcde", 5)).toEqual({ value: "ABCD-E", caret: 6 });
  });

  it("keeps the caret in place when a character is typed before the dash", () => {
    expect(reformatInviteWithCaret("AXBCD-E", 2)).toEqual({ value: "AXBC-DE", caret: 2 });
  });

  it("drops a dash that has nothing after it", () => {
    expect(reformatInviteWithCaret("ABCD-", 5)).toEqual({ value: "ABCD", caret: 4 });
  });

  it("does not count spaces or dashes before the caret", () => {
    expect(reformatInviteWithCaret("ab cd-ef", 8)).toEqual({ value: "ABCD-EF", caret: 7 });
  });

  it("clamps the caret to the end when extra characters are cut", () => {
    expect(reformatInviteWithCaret("ABCD-23456", 10)).toEqual({ value: "ABCD-2345", caret: 9 });
  });
});
