import { describe, expect, it } from "vitest";
import { devRoutesEnabled } from "./dev-guard";

describe("devRoutesEnabled", () => {
  it("is true in demo", () => {
    expect(devRoutesEnabled({ APP_MODE: "demo" })).toBe(true);
  });
  it("is false in live", () => {
    expect(devRoutesEnabled({ APP_MODE: "live" })).toBe(false);
  });
});
