import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "@/server/db";
import { oauthPendingSignups } from "@/server/db/schema";

// A Google sign-up in progress has one server row; its id rides in the sealed pending cookie.
// Completing the sign-up consumes the row, so the cookie works once and a replay is refused
// (A8 review L3).

type Executor = Pick<ReturnType<typeof db>, "insert" | "delete" | "select">;

/** A new pending sign-up valid until `expiresAt`; expired rows are swept on the way. */
export async function createPendingSignup(expiresAt: Date, now: Date): Promise<string> {
  const id = uuidv7();
  await db().delete(oauthPendingSignups).where(lt(oauthPendingSignups.expiresAt, now));
  await db().insert(oauthPendingSignups).values({ id, expiresAt });
  return id;
}

/** Whether the pending sign-up can still be completed. */
export async function isPendingSignupLive(id: string, now: Date): Promise<boolean> {
  const [row] = await db()
    .select({ id: oauthPendingSignups.id })
    .from(oauthPendingSignups)
    .where(and(eq(oauthPendingSignups.id, id), gt(oauthPendingSignups.expiresAt, now)))
    .limit(1);
  return row !== undefined;
}

/** Spends the pending sign-up; false when it was already spent or has expired. */
export async function consumePendingSignup(
  executor: Executor,
  id: string,
  now: Date,
): Promise<boolean> {
  const deleted = await executor
    .delete(oauthPendingSignups)
    .where(and(eq(oauthPendingSignups.id, id), gt(oauthPendingSignups.expiresAt, now)))
    .returning({ id: oauthPendingSignups.id });
  return deleted.length === 1;
}
