import { describe, expect, it } from "vitest";
import { dashboardViewForRole, isViewAsEnabled, resolveView } from "./views";

describe("dashboardViewForRole", () => {
  it("gives every role its own view", () => {
    for (const role of ["student", "parent", "teacher", "admin", "reviewer"] as const) {
      expect(dashboardViewForRole(role)).toBe(role);
    }
  });

  it("does not hand a reviewer the admin view", () => {
    expect(dashboardViewForRole("reviewer")).not.toBe("admin");
  });
});

describe("isViewAsEnabled", () => {
  it("shows the view-as switcher only in the demo", () => {
    expect(isViewAsEnabled("demo")).toBe(true);
    expect(isViewAsEnabled("live")).toBe(false);
  });
});

describe("resolveView", () => {
  it("returns a sample view only when the demo asks for one", () => {
    expect(resolveView("demo", "teacher")).toBe("teacher");
    expect(resolveView("demo", undefined)).toBeNull();
    expect(resolveView("demo", "nope")).toBeNull();
  });

  it("ignores ?view= in live mode, so no role previews another", () => {
    expect(resolveView("live", "admin")).toBeNull();
  });
});
