import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clock } from "@/server/clock";
import { SESSION_TTL_MS } from "@/server/config/policy";
import { db } from "@/server/db";
import { sessions, type User, users } from "@/server/db/schema";
import { randomToken, sha256 } from "./password";

const SESSION_COOKIE = "alnamer_session";

export type SessionUser = Pick<User, "id" | "name" | "email" | "role">;

export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(clock.now().getTime() + SESSION_TTL_MS);
  await db()
    .insert(sessions)
    .values({ tokenHash: sha256(token), userId, expiresAt });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token)
    await db()
      .delete(sessions)
      .where(eq(sessions.tokenHash, sha256(token)));
  store.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.userId, userId));
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, clock.now())))
    .limit(1);
  return row ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
