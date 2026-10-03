import "server-only";
import { eq } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { parentLinks, users } from "@/server/db/schema";
import { isUnder18 } from "./age";

/**
 * True for a student whose date of birth makes them under 18 today (Cairo date) and who has no
 * linked parent yet: they should link one. A parent-created child is linked from the start.
 */
export async function shouldPromptParentLink(userId: string): Promise<boolean> {
  const row = await db().query.users.findFirst({
    columns: { role: true, dateOfBirth: true },
    where: eq(users.id, userId),
  });
  if (row?.role !== "student" || !row.dateOfBirth) return false;
  if (!isUnder18(row.dateOfBirth, clock.now())) return false;
  const link = await db().query.parentLinks.findFirst({
    columns: { id: true },
    where: eq(parentLinks.studentId, userId),
  });
  return !link;
}
