import "server-only";
import { getCurrentSession, type SessionUser } from "./session";
import { passesTwoFactor } from "./staff-session";

/**
 * The user a server action or route handler acts for: the signed-in user, except a staff session
 * that has not passed two-factor, which acts for no one (A8 review L4).
 */
export async function getActingUser(): Promise<SessionUser | null> {
  const session = await getCurrentSession();
  return session && passesTwoFactor(session) ? session.user : null;
}
