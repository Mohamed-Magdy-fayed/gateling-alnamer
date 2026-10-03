import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { errorTitle, FALLBACK_TITLE } from "./error-texts";

const appRoot = path.resolve(import.meta.dirname, "../../app/(app)");

describe("error boundaries", () => {
  it("never gives an empty title, with or without the translated texts", () => {
    expect(errorTitle(null).trim()).not.toBe("");
    expect(errorTitle(null)).toBe(FALLBACK_TITLE);
    expect(errorTitle({ message: "x", retry: "y", home: "z" })).toBe("x");
  });

  it("keeps the shell on a dashboard page error with its own boundary", () => {
    expect(existsSync(path.join(appRoot, "dashboard", "error.tsx"))).toBe(true);
    expect(existsSync(path.join(appRoot, "error.tsx"))).toBe(true);
  });
});
