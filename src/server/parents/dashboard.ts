import "server-only";
import { and, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { canParentSetPassword, listChildrenForParent } from "./service";
import { listActiveInvites } from "./views";

/** A child card as the client renders it: the service card plus how a reset would work. */
export type ParentChild = {
  childId: string;
  displayName: string;
  username: string | null;
  ageYears: number | null;
  maskedEmail: string | null;
  /** Whether the child has a confirmed email, so an email reset can reach them. */
  emailVerified: boolean;
  source: "created_child" | "invite";
  /** `direct` asks for a new password; `email` sends a code to the child's verified email. */
  resetMode: "direct" | "email";
};

export type ParentInvite = { id: string; expiresAt: string };

export type ParentDashboardData = { children: ParentChild[]; invites: ParentInvite[] };

/** Which of these children have a confirmed email (a boolean only; the address stays masked). */
async function verifiedChildIds(childIds: string[]): Promise<Set<string>> {
  if (childIds.length === 0) return new Set();
  const rows = await db()
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, childIds), isNotNull(users.emailVerifiedAt)));
  return new Set(rows.map((row) => row.id));
}

/** Everything the parent cards need, in plain serialisable values. */
export async function loadParentDashboard(parentId: string): Promise<ParentDashboardData> {
  const [cards, invites] = await Promise.all([
    listChildrenForParent(parentId),
    listActiveInvites(parentId),
  ]);
  const verified = await verifiedChildIds(cards.map((card) => card.childId));
  const children = await Promise.all(
    cards.map(async (card): Promise<ParentChild> => {
      const mode = await canParentSetPassword(parentId, card.childId);
      return {
        childId: card.childId,
        displayName: card.displayName,
        username: card.username,
        ageYears: card.ageYears,
        maskedEmail: card.maskedEmail,
        emailVerified: verified.has(card.childId),
        source: card.source,
        resetMode: mode === "direct" ? "direct" : "email",
      };
    }),
  );
  return {
    children,
    invites: invites.map((invite) => ({
      id: invite.id,
      expiresAt: invite.expiresAt.toISOString(),
    })),
  };
}
