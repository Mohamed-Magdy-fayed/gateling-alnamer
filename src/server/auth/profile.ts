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
export async function shouldPromptParentLink(user: { id: string; role: string }): Promise<boolean> {
  // Only students are ever prompted, so every other role costs no query.
  if (user.role !== "student") return false;
  const userId = user.id;
  const row = await db().query.users.findFirst({
    columns: { dateOfBirth: true },
    where: eq(users.id, userId),
  });
  if (!row?.dateOfBirth) return false;
  if (!isUnder18(row.dateOfBirth, clock.now())) return false;
  const link = await db().query.parentLinks.findFirst({
    columns: { id: true },
    where: eq(parentLinks.studentId, userId),
  });
  return !link;
}

/**
 * The account's public number, the readable id the video watermark carries next to the display
 * name (MASTER-PLAN T23). Accounts made before public numbers existed fall back to an id prefix.
 */
export async function watermarkNumber(userId: string): Promise<string> {
  const row = await db().query.users.findFirst({
    columns: { publicNumber: true },
    where: eq(users.id, userId),
  });
  return row?.publicNumber ?? `AN-${userId.slice(0, 6).toUpperCase()}`;
}
