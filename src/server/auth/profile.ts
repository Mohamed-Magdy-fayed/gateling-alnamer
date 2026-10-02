import "server-only";
import { eq } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { isUnder18 } from "./age";

/** True for a student whose date of birth makes them under 18 today (Cairo date): they should link a parent. */
export async function shouldPromptParentLink(userId: string): Promise<boolean> {
  const row = await db().query.users.findFirst({
    columns: { role: true, dateOfBirth: true },
    where: eq(users.id, userId),
  });
  if (row?.role !== "student" || !row.dateOfBirth) return false;
  return isUnder18(row.dateOfBirth, clock.now());
}
