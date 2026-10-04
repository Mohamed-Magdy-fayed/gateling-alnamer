import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

/** Whether the account's email is confirmed; accounts without an email never need the banner. */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const row = await db().query.users.findFirst({
    columns: { emailVerifiedAt: true },
    where: eq(users.id, userId),
  });
  return Boolean(row?.emailVerifiedAt);
}
