import { describe, expect, it } from "vitest";
import { type CheckoutActorInput, decideCheckoutActor } from "./checkout-policy";

const base: CheckoutActorInput = {
  role: "student",
  hasEmail: true,
  emailVerified: true,
  target: "self",
};
const decide = (over: Partial<CheckoutActorInput>) => decideCheckoutActor({ ...base, ...over });

describe("decideCheckoutActor", () => {
  it("student buys for self with a verified email", () => {
    expect(decide({})).toEqual({ ok: true, beneficiary: "self" });
    expect(decide({ target: "none" })).toEqual({ ok: true, beneficiary: "self" });
  });

  it("student without an email must ask a parent", () => {
    expect(decide({ hasEmail: false, emailVerified: false })).toEqual({
      ok: false,
      reason: "ask_parent",
    });
  });

  it("student with an unverified email must verify first", () => {
    expect(decide({ emailVerified: false })).toEqual({ ok: false, reason: "verify_email" });
  });

  it("student cannot buy for someone else", () => {
    expect(decide({ target: "linked_child" })).toEqual({ ok: false, reason: "forbidden" });
    expect(decide({ target: "unlinked" })).toEqual({ ok: false, reason: "forbidden" });
  });

  it("parent buys for a linked child with a verified email", () => {
    expect(decide({ role: "parent", target: "linked_child" })).toEqual({
      ok: true,
      beneficiary: "child",
    });
  });

  it("parent needs a verified email (D35)", () => {
    expect(decide({ role: "parent", target: "linked_child", emailVerified: false })).toEqual({
      ok: false,
      reason: "verify_email",
    });
  });

  it("parent cannot buy for an unlinked child or for no one", () => {
    expect(decide({ role: "parent", target: "unlinked" })).toEqual({
      ok: false,
      reason: "not_linked",
    });
    expect(decide({ role: "parent", target: "none" })).toEqual({ ok: false, reason: "forbidden" });
    expect(decide({ role: "parent", target: "self" })).toEqual({ ok: false, reason: "forbidden" });
  });

  it("teachers, reviewers and admins are refused", () => {
    for (const role of ["teacher", "reviewer", "admin"] as const) {
      expect(decide({ role })).toEqual({ ok: false, reason: "forbidden" });
    }
  });
});
