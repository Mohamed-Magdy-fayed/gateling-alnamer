import "server-only";
import { asc, eq } from "drizzle-orm";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { parentLinks, users } from "@/server/db/schema";
import { activeAccessEnds } from "./my-courses";

export type BuyChild = { id: string; name: string; accessEndsAt: Date | null };

/**
 * What the course page's buy box shows for the viewer. It mirrors the checkout rules (the server
 * re-checks everything on `orders.start`), so a refusal is explained before the click.
 */
export type BuyState =
  | { kind: "anonymous" }
  | { kind: "not_buyer" }
  | { kind: "student_can_buy" }
  | { kind: "student_verify_email" }
  | { kind: "student_ask_parent" }
  | { kind: "student_has_access"; endsAt: Date }
  | { kind: "parent_verify_email" }
  | { kind: "parent_no_children" }
  | { kind: "parent"; children: BuyChild[] };

async function accountFacts(userId: string) {
  const [row] = await db()
    .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { hasEmail: Boolean(row?.email), verified: Boolean(row?.emailVerifiedAt) };
}

async function linkedChildren(parentId: string): Promise<{ id: string; name: string }[]> {
  return db()
    .select({ id: users.id, name: users.name })
    .from(parentLinks)
    .innerJoin(users, eq(users.id, parentLinks.studentId))
    .where(eq(parentLinks.parentId, parentId))
    .orderBy(asc(users.name));
}

export async function getBuyState(
  user: SessionUser | null,
  courseId: string,
  now: Date,
): Promise<BuyState> {
  if (!user) return { kind: "anonymous" };
  if (user.role === "student") {
    const ends = await activeAccessEnds([user.id], courseId, now);
    const endsAt = ends.get(user.id);
    if (endsAt) return { kind: "student_has_access", endsAt };
    const facts = await accountFacts(user.id);
    if (!facts.hasEmail) return { kind: "student_ask_parent" };
    if (!facts.verified) return { kind: "student_verify_email" };
    return { kind: "student_can_buy" };
  }
  if (user.role === "parent") {
    const facts = await accountFacts(user.id);
    if (!facts.verified) return { kind: "parent_verify_email" };
    const children = await linkedChildren(user.id);
    if (children.length === 0) return { kind: "parent_no_children" };
    const ends = await activeAccessEnds(
      children.map((child) => child.id),
      courseId,
      now,
    );
    return {
      kind: "parent",
      children: children.map((child) => ({
        id: child.id,
        name: child.name,
        accessEndsAt: ends.get(child.id) ?? null,
      })),
    };
  }
  return { kind: "not_buyer" };
}
