import "server-only";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { linkInvites, type parentLinkSource, parentLinks, users } from "@/server/db/schema";
import { maskEmail } from "./service";

/** A live invite as the parent sees it. The code is never stored and never listed. */
export type ActiveInvite = { id: string; expiresAt: Date };

export async function listActiveInvites(parentId: string): Promise<ActiveInvite[]> {
  return db()
    .select({ id: linkInvites.id, expiresAt: linkInvites.expiresAt })
    .from(linkInvites)
    .where(
      and(
        eq(linkInvites.parentId, parentId),
        isNull(linkInvites.redeemedAt),
        gt(linkInvites.expiresAt, clock.now()),
      ),
    )
    .orderBy(asc(linkInvites.expiresAt), asc(linkInvites.id));
}

/** A linked parent as the student sees them: display name and masked email only. */
export type LinkedParent = {
  parentId: string;
  displayName: string;
  maskedEmail: string | null;
  source: (typeof parentLinkSource.enumValues)[number];
};

export async function listParentsForStudent(studentId: string): Promise<LinkedParent[]> {
  const rows = await db()
    .select({
      parentId: users.id,
      displayName: users.name,
      email: users.email,
      source: parentLinks.source,
    })
    .from(parentLinks)
    .innerJoin(users, eq(users.id, parentLinks.parentId))
    .where(eq(parentLinks.studentId, studentId))
    .orderBy(asc(parentLinks.createdAt), asc(users.id));
  return rows.map((row) => ({
    parentId: row.parentId,
    displayName: row.displayName,
    maskedEmail: row.email ? maskEmail(row.email) : null,
    source: row.source,
  }));
}
