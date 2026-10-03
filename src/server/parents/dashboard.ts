import "server-only";
import { canParentSetPassword, listChildrenForParent } from "./service";
import { listActiveInvites } from "./views";

/** A child card as the client renders it: the service card plus how a reset would work. */
export type ParentChild = {
  childId: string;
  displayName: string;
  username: string | null;
  ageYears: number | null;
  maskedEmail: string | null;
  source: "created_child" | "invite";
  /** `direct` asks for a new password; `email` sends a code to the child's verified email. */
  resetMode: "direct" | "email";
};

export type ParentInvite = { id: string; expiresAt: string };

export type ParentDashboardData = { children: ParentChild[]; invites: ParentInvite[] };

/** Everything the parent cards need, in plain serialisable values. */
export async function loadParentDashboard(parentId: string): Promise<ParentDashboardData> {
  const [cards, invites] = await Promise.all([
    listChildrenForParent(parentId),
    listActiveInvites(parentId),
  ]);
  const children = await Promise.all(
    cards.map(async (card): Promise<ParentChild> => {
      const mode = await canParentSetPassword(parentId, card.childId);
      return {
        childId: card.childId,
        displayName: card.displayName,
        username: card.username,
        ageYears: card.ageYears,
        maskedEmail: card.maskedEmail,
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
