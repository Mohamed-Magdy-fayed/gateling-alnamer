import { describe, expect, it } from "vitest";
import { dashboardViewForRole } from "./views";

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
