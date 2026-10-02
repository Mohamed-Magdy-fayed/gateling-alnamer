import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { requireUser, type SessionUser } from "./session";

/** For checkout and other purchase paths: signed in, and the email is confirmed. */
export async function requireVerifiedEmail(): Promise<SessionUser> {
  const user = await requireUser();
  const row = await db().query.users.findFirst({
    columns: { emailVerifiedAt: true },
    where: eq(users.id, user.id),
  });
  if (!row?.emailVerifiedAt) throw new AppError("forbidden");
  return user;
}
