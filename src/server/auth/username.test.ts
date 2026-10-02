import { describe, expect, it } from "vitest";
import { RESERVED_USERNAMES, usernameSchema } from "./username";

describe("usernameSchema", () => {
  it.each(["abc", "a_b.c9", "user.name_1", "x".repeat(20)])("accepts %s", (value) => {
    expect(usernameSchema.safeParse(value).success).toBe(true);
  });

  it("trims and lower-cases", () => {
    expect(usernameSchema.parse("  Sara.M  ")).toBe("sara.m");
  });

  it.each(["ab", "x".repeat(21), "has space", "dash-ed", "al-namer", "ünï", "a@b", ""])(
    "rejects %j",
    (value) => {
      expect(usernameSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects every reserved name in any case", () => {
    for (const name of RESERVED_USERNAMES) {
      expect(usernameSchema.safeParse(name).success).toBe(false);
      expect(usernameSchema.safeParse(name.toUpperCase()).success).toBe(false);
    }
  });
});
