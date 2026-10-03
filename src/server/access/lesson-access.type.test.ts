import { describe, expect, it } from "vitest";
import type { AccessGranted } from "./lesson-access";

describe("AccessGranted brand", () => {
  it("cannot be built from an object literal outside lesson-access.ts", () => {
    // @ts-expect-error a plain object lacks the module-private brand
    const forged: AccessGranted = { lessonId: "l", userId: "u", mode: "entitled" };
    expect(forged.lessonId).toBe("l");
  });

  it("cannot be built by a cast-free spread of a valid grant shape", () => {
    // @ts-expect-error the brand symbol is not exported, so no literal can carry it
    const forged: AccessGranted = { lessonId: "l", userId: "u", mode: "preview", brand: true };
    expect(forged.mode).toBe("preview");
  });
});
