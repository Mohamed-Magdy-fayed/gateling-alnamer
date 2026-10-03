import type { UserRole } from "@/server/db/schema";

/** How the requested beneficiary relates to the buyer, resolved by the caller from the database. */
export type CheckoutTarget = "self" | "linked_child" | "unlinked" | "none";

export type CheckoutActorInput = {
  role: UserRole;
  hasEmail: boolean;
  emailVerified: boolean;
  target: CheckoutTarget;
};

export type CheckoutActorDecision =
  | { ok: true; beneficiary: "self" | "child" }
  | { ok: false; reason: "forbidden" | "ask_parent" | "verify_email" | "not_linked" };

/**
 * Who may buy, and for whom. A student buys for themself with a verified email (one without an
 * email asks a parent). A parent buys for a linked child with their own verified email (D35).
 * Everyone else is refused.
 */
export function decideCheckoutActor(input: CheckoutActorInput): CheckoutActorDecision {
  if (input.role === "student") {
    if (input.target === "linked_child" || input.target === "unlinked") {
      return { ok: false, reason: "forbidden" };
    }
    if (!input.hasEmail) return { ok: false, reason: "ask_parent" };
    if (!input.emailVerified) return { ok: false, reason: "verify_email" };
    return { ok: true, beneficiary: "self" };
  }
  if (input.role === "parent") {
    if (input.target === "unlinked") return { ok: false, reason: "not_linked" };
    if (input.target !== "linked_child") return { ok: false, reason: "forbidden" };
    if (!input.emailVerified) return { ok: false, reason: "verify_email" };
    return { ok: true, beneficiary: "child" };
  }
  return { ok: false, reason: "forbidden" };
}
