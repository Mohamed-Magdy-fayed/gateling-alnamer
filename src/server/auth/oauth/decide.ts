import "server-only";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Locale } from "@/i18n/config";
import { writeAudit } from "@/server/audit/repository";
import { db } from "@/server/db";
import { oauthAccounts, users } from "@/server/db/schema";
import { nextPublicNumber } from "../public-number";
import { checkSignUpAge, isUniqueViolation } from "../sign-up";
import { isStaffRole } from "../staff-session";
import type { OAuthIdentity } from "./provider";

const PROVIDER = "google";

export type OAuthDecision =
  | { kind: "signin"; userId: string }
  | { kind: "needs_password" }
  | { kind: "new" }
  | { kind: "refused" };

/**
 * What a Google identity means here (A3):
 * - already linked: sign that user in;
 * - a verified Google email equal to a verified account email: link (audit-logged) and sign in;
 * - an account with that email but unverified: no link (it could be someone else's pre-registration),
 *   the person signs in with the password first;
 * - no account: a new sign-up; an unverified Google email or a suspended account: refused.
 */
export async function resolveOAuthSignIn(identity: OAuthIdentity): Promise<OAuthDecision> {
  const [linked] = await db()
    .select({ userId: oauthAccounts.userId, status: users.status })
    .from(oauthAccounts)
    .innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, PROVIDER), eq(oauthAccounts.subject, identity.subject)))
    .limit(1);
  if (linked) {
    return linked.status === "active"
      ? { kind: "signin", userId: linked.userId }
      : { kind: "refused" };
  }
  if (!identity.emailVerified) return { kind: "refused" };

  const [account] = await db()
    .select({
      id: users.id,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      role: users.role,
    })
    .from(users)
    .where(eq(users.email, identity.email))
    .limit(1);
  if (!account) return { kind: "new" };
  if (account.status !== "active") return { kind: "refused" };
  if (!account.emailVerifiedAt) return { kind: "needs_password" };
  // Staff accounts are never linked by email alone (a domain admin can create a Google account for
  // any address on the domain): sign in with the password first.
  if (isStaffRole(account.role)) {
    return { kind: "needs_password" };
  }

  await db().transaction(async (tx) => {
    const inserted = await tx
      .insert(oauthAccounts)
      .values({
        id: uuidv7(),
        userId: account.id,
        provider: PROVIDER,
        subject: identity.subject,
        email: identity.email,
      })
      .onConflictDoNothing()
      .returning({ id: oauthAccounts.id });
    if (inserted.length === 0) return;
    await writeAudit(tx, {
      actorId: account.id,
      action: "oauth.linked",
      subjectType: "user",
      subjectId: account.id,
      after: { provider: PROVIDER },
    });
  });
  return { kind: "signin", userId: account.id };
}

export type GoogleSignUpForm = {
  name: string;
  role: "student" | "parent";
  dateOfBirth: string;
  guardianConsent: boolean;
};

export type GoogleSignUpResult =
  | { ok: true; userId: string }
  | { ok: false; fields: string[]; reasons?: Record<string, string> }
  | { ok: false; decision: OAuthDecision };

/**
 * Creates the account for a new Google user: verified email (Google verified it), no password,
 * a public number and the Google link, in one transaction; the D31 age rules apply. If the email
 * was taken meanwhile, the usual linking rules decide.
 */
export async function completeGoogleSignUp(
  identity: OAuthIdentity,
  form: GoogleSignUpForm,
  ctx: { locale: Locale; now: Date },
): Promise<GoogleSignUpResult> {
  const name = form.name.trim();
  if (name.length < 2 || name.length > 80) return { ok: false, fields: ["name"] };
  if (form.role !== "student" && form.role !== "parent") return { ok: false, fields: ["role"] };
  const age = checkSignUpAge(form.role, form.dateOfBirth, form.guardianConsent, ctx.now);
  if (!age.ok) {
    const result = age.result;
    return "fields" in result
      ? { ok: false, fields: [...result.fields], reasons: { ...(result.reasons ?? {}) } }
      : { ok: false, fields: ["date_of_birth"] };
  }
  if (!identity.emailVerified) return { ok: false, decision: { kind: "refused" } };

  try {
    const userId = await db().transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          name,
          email: identity.email,
          role: form.role,
          dateOfBirth: age.dateOfBirth,
          guardianConsentAt: age.guardianConsentAt,
          locale: ctx.locale,
          emailVerifiedAt: ctx.now,
          publicNumber: await nextPublicNumber(tx),
        })
        .returning({ id: users.id });
      if (!user) throw new Error("user insert returned no row");
      await tx.insert(oauthAccounts).values({
        id: uuidv7(),
        userId: user.id,
        provider: PROVIDER,
        subject: identity.subject,
        email: identity.email,
      });
      return user.id;
    });
    return { ok: true, userId };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { ok: false, decision: await resolveOAuthSignIn(identity) };
  }
}
