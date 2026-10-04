import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Locale } from "@/i18n/config";
import { writeAudit } from "@/server/audit/repository";
import {
  type AbuseDeps,
  guardChildCreate,
  guardInviteRedeem,
  guardParentReset,
} from "@/server/auth/abuse";
import { ageOn, isUnder18 } from "@/server/auth/age";
import { setPasswordIn } from "@/server/auth/credentials";
import { hashPassword } from "@/server/auth/password";
import { isAcceptablePassword, passwordSchema } from "@/server/auth/password-policy";
import { nextPublicNumber } from "@/server/auth/public-number";
import { sendCode as defaultSendCode } from "@/server/auth/send-code";
import { deleteUserSessionsIn, purgeSessionCache } from "@/server/auth/session-invalidate";
import { validDateOfBirth } from "@/server/auth/sign-up";
import { usernameSchema } from "@/server/auth/username";
import { clock } from "@/server/clock";
import {
  INVITE_TTL_MS,
  MAX_ACTIVE_INVITES_PER_PARENT,
  MAX_CHILDREN_PER_PARENT,
  MAX_PARENTS_PER_STUDENT,
} from "@/server/config/policy";
import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import {
  credentials,
  linkInvites,
  type parentLinkSource,
  parentLinks,
  type UserRole,
  users,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { formatInviteCode, generateInviteCode, hashInviteCode } from "./invite-code";

type Database = ReturnType<typeof db>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type LinkSource = (typeof parentLinkSource.enumValues)[number];

export type ParentDeps = AbuseDeps & { readonly sendCode?: typeof defaultSendCode };

/** Serialises writes that count a parent's or a student's links, so caps cannot be raced past. */
async function lock(tx: Tx, scope: "parent" | "student", id: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${scope}-links:${id}`}))`);
}

type ParentState = "ok" | "forbidden" | "verifyFirst";

/** A parent acts only while active and with a verified email (D35). */
async function parentState(tx: Database | Tx, parentId: string): Promise<ParentState> {
  const [row] = await tx
    .select({ emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(and(eq(users.id, parentId), eq(users.role, "parent"), eq(users.status, "active")))
    .limit(1);
  if (!row) return "forbidden";
  return row.emailVerifiedAt ? "ok" : "verifyFirst";
}

async function countChildren(tx: Tx, parentId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(parentLinks)
    .where(eq(parentLinks.parentId, parentId));
  return row?.n ?? 0;
}

/** First character, then `***@`, then the domain: what a parent may see of a child's email. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.charAt(0)}***@${email.slice(at + 1)}`;
}

// ---- Child creation ----

export type CreateChildField = "name" | "username" | "password" | "date_of_birth";
export type CreateChildResult =
  | { ok: true; childId: string }
  | { ok: false; code: "invalid"; fields: CreateChildField[] }
  | {
      ok: false;
      code: "duplicate" | "forbidden" | "verifyFirst" | "rateLimited" | "limitChildren";
    };

const createChildSchema = z.object({
  name: z.string().trim().min(2).max(80),
  username: usernameSchema,
  password: passwordSchema,
  date_of_birth: z.string(),
});

const KNOWN_FIELDS: readonly CreateChildField[] = ["name", "username", "password", "date_of_birth"];

function invalid(fields: CreateChildField[]): CreateChildResult {
  return { ok: false, code: "invalid", fields };
}

/**
 * A parent creates a child account: validation (the sign-up rules, the child must be under 18),
 * then user + credential + public number + link + audit in one transaction. The parent is the
 * guardian, so consent is recorded now and in the `parent.create_child` audit entry. The child
 * has no email (it adds one later from its account page). The parent must have a verified email.
 * At most 10 children per parent and 10 creations a day.
 */
export async function createChild(
  parentId: string,
  raw: Record<string, unknown>,
  ctx: { locale: Locale },
  deps: ParentDeps = {},
): Promise<CreateChildResult> {
  const guard = await guardChildCreate({ parentId }, deps);
  if (!("ok" in guard)) return { ok: false, code: "rateLimited" };

  const parsed = createChildSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = new Set<CreateChildField>();
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      const known = KNOWN_FIELDS.find((field) => field === key);
      if (known) fields.add(known);
    }
    return invalid([...fields]);
  }
  const input = parsed.data;
  const now = clock.now();
  const dateOfBirth = validDateOfBirth(input.date_of_birth, now);
  if (!dateOfBirth || !isUnder18(dateOfBirth, now)) return invalid(["date_of_birth"]);

  const passwordHash = await hashPassword(input.password);

  try {
    const outcome = await db().transaction(async (tx) => {
      await lock(tx, "parent", parentId);
      const state = await parentState(tx, parentId);
      if (state !== "ok") return { ok: false, code: state } as const;
      if ((await countChildren(tx, parentId)) >= MAX_CHILDREN_PER_PARENT) {
        return { ok: false, code: "limitChildren" } as const;
      }
      const [child] = await tx
        .insert(users)
        .values({
          name: input.name,
          username: input.username,
          role: "student",
          dateOfBirth,
          guardianConsentAt: now,
          locale: ctx.locale,
          publicNumber: await nextPublicNumber(tx),
          createdByParentId: parentId,
        })
        .returning({ id: users.id });
      if (!child) throw new Error("child insert returned no row");
      await tx.insert(credentials).values({ userId: child.id, passwordHash, passwordSalt: null });
      await tx
        .insert(parentLinks)
        .values({ parentId, studentId: child.id, source: "created_child" });
      await writeAudit(tx, {
        actorId: parentId,
        action: "parent.create_child",
        subjectType: "user",
        subjectId: child.id,
        after: { consent: "guardian" },
      });
      return { ok: true, childId: child.id } as const;
    });
    return outcome;
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "duplicate" };
    throw new AppError("internal");
  }
}

// ---- Invites ----

export type IssueInviteResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; code: "forbidden" | "verifyFirst" | "limitInvites" };

/** Issues a link code (`XXXX-XXXX`, 7 days). Only a keyed hash is stored; at most 5 are live at once. */
export async function issueInvite(parentId: string): Promise<IssueInviteResult> {
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  return db().transaction(async (tx) => {
    await lock(tx, "parent", parentId);
    const state = await parentState(tx, parentId);
    if (state !== "ok") return { ok: false, code: state } as const;
    const [live] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(linkInvites)
      .where(
        and(
          eq(linkInvites.parentId, parentId),
          isNull(linkInvites.redeemedAt),
          gt(linkInvites.expiresAt, now),
        ),
      );
    if ((live?.n ?? 0) >= MAX_ACTIVE_INVITES_PER_PARENT) {
      return { ok: false, code: "limitInvites" } as const;
    }
    const code = generateInviteCode();
    await tx.insert(linkInvites).values({ parentId, codeHash: hashInviteCode(code), expiresAt });
    return { ok: true, code: formatInviteCode(code), expiresAt } as const;
  });
}

export type RedeemInviteResult =
  | { ok: true; parentId: string }
  | { ok: false; code: "invalid" | "limitParents" | "limitChildren" | "rateLimited" };

const INVALID_INVITE: RedeemInviteResult = { ok: false, code: "invalid" };

/**
 * A student redeems a code. Wrong, expired, used and not-for-you codes are all the one `invalid`
 * result; every attempt counts against 5 per 15 minutes per student and 20 an hour per IP. A
 * student with two parents gets `limitParents`; a parent at 10 children gets `limitChildren`.
 */
export async function redeemInvite(
  input: { studentId: string; code: string; ip: string },
  deps: ParentDeps = {},
): Promise<RedeemInviteResult> {
  const guard = await guardInviteRedeem({ studentId: input.studentId, ip: input.ip }, deps);
  if (!("ok" in guard)) return { ok: false, code: "rateLimited" };

  const codeHash = hashInviteCode(input.code);
  const now = clock.now();
  return db().transaction(async (tx): Promise<RedeemInviteResult> => {
    await lock(tx, "student", input.studentId);
    const [student] = await tx
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, input.studentId))
      .limit(1);
    if (student?.role !== "student" || student.status !== "active") return INVALID_INVITE;

    const [parents] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(parentLinks)
      .where(eq(parentLinks.studentId, input.studentId));
    if ((parents?.n ?? 0) >= MAX_PARENTS_PER_STUDENT) return { ok: false, code: "limitParents" };

    const [invite] = await tx
      .select({ id: linkInvites.id, parentId: linkInvites.parentId })
      .from(linkInvites)
      .where(
        and(
          eq(linkInvites.codeHash, codeHash),
          isNull(linkInvites.redeemedAt),
          gt(linkInvites.expiresAt, now),
        ),
      )
      .limit(1);
    if (!invite) return INVALID_INVITE;

    await lock(tx, "parent", invite.parentId);
    if ((await parentState(tx, invite.parentId)) !== "ok") return INVALID_INVITE;
    const [existing] = await tx
      .select({ id: parentLinks.id })
      .from(parentLinks)
      .where(
        and(eq(parentLinks.parentId, invite.parentId), eq(parentLinks.studentId, input.studentId)),
      )
      .limit(1);
    if (existing) return INVALID_INVITE;
    if ((await countChildren(tx, invite.parentId)) >= MAX_CHILDREN_PER_PARENT) {
      return { ok: false, code: "limitChildren" };
    }

    const [claimed] = await tx
      .update(linkInvites)
      .set({ redeemedAt: now, redeemedBy: input.studentId })
      .where(
        and(
          eq(linkInvites.id, invite.id),
          isNull(linkInvites.redeemedAt),
          gt(linkInvites.expiresAt, now),
        ),
      )
      .returning({ id: linkInvites.id });
    if (!claimed) return INVALID_INVITE;

    await tx
      .insert(parentLinks)
      .values({ parentId: invite.parentId, studentId: input.studentId, source: "invite" });
    await writeAudit(tx, {
      actorId: input.studentId,
      action: "parent.link",
      subjectType: "user",
      subjectId: input.studentId,
      after: { source: "invite", parentId: invite.parentId },
    });
    return { ok: true, parentId: invite.parentId };
  });
}

// ---- Unlink ----

/** A created child may unlink once 18 or once it has a verified email of its own. */
async function studentCanLeave(tx: Tx, studentId: string): Promise<boolean> {
  const [row] = await tx
    .select({ dateOfBirth: users.dateOfBirth, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, studentId))
    .limit(1);
  if (!row) return false;
  if (row.emailVerifiedAt) return true;
  return row.dateOfBirth ? !isUnder18(row.dateOfBirth, clock.now()) : false;
}

export type UnlinkResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Unlink rules: an `invite` link can be removed by its parent, its student or an admin. A
 * `created_child` link by an admin, or by the student once they are 18 or have a verified email (so
 * they have their own recovery path); never by the parent.
 */
export async function unlinkParent(input: {
  actor: { id: string; role: UserRole };
  parentId: string;
  studentId: string;
}): Promise<UnlinkResult> {
  const { actor, parentId, studentId } = input;
  return db().transaction(async (tx): Promise<UnlinkResult> => {
    const [row] = await tx
      .select({ id: parentLinks.id, source: parentLinks.source })
      .from(parentLinks)
      .where(and(eq(parentLinks.parentId, parentId), eq(parentLinks.studentId, studentId)))
      .limit(1);
    if (!row) return { ok: false, reason: "not_found" };

    const isAdmin = actor.role === "admin";
    const isParty =
      (actor.role === "parent" && actor.id === parentId) ||
      (actor.role === "student" && actor.id === studentId);
    let allowed = isAdmin;
    if (!allowed && row.source === "invite") allowed = isParty;
    if (!allowed && row.source === "created_child" && actor.role === "student") {
      allowed = actor.id === studentId && (await studentCanLeave(tx, studentId));
    }
    if (!allowed) return { ok: false, reason: "forbidden" };

    await tx.delete(parentLinks).where(eq(parentLinks.id, row.id));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "parent.unlink",
      subjectType: "user",
      subjectId: studentId,
      after: { source: row.source, parentId, actorRole: actor.role },
    });
    return { ok: true };
  });
}

// ---- Password reset by a parent ----

export type ResetMode = "forbidden" | "direct" | "email";

/**
 * The matrix (D35): no link forbids. Direct only for a linked child (created by this parent or
 * linked by invite) who is under 18 (Cairo date) and has no verified email; everything else is email.
 */
export function resetMode(input: {
  linked: boolean;
  source: LinkSource | null;
  parentId: string;
  createdByParentId: string | null;
  dateOfBirth: string | null;
  emailVerifiedAt: Date | null;
  now: Date;
}): ResetMode {
  if (!input.linked) return "forbidden";
  const ownLink = input.createdByParentId === input.parentId || input.source === "invite";
  const minor = input.dateOfBirth ? isUnder18(input.dateOfBirth, input.now) : false;
  return ownLink && minor && !input.emailVerifiedAt ? "direct" : "email";
}

type ChildFacts = {
  mode: ResetMode;
  name: string;
  email: string | null;
  emailVerified: boolean;
  locale: string | null;
};

async function childFacts(
  executor: Database | Tx,
  parentId: string,
  childId: string,
): Promise<ChildFacts> {
  const [row] = await executor
    .select({
      linkId: parentLinks.id,
      source: parentLinks.source,
      createdByParentId: users.createdByParentId,
      dateOfBirth: users.dateOfBirth,
      emailVerifiedAt: users.emailVerifiedAt,
      name: users.name,
      email: users.email,
      locale: users.locale,
    })
    .from(users)
    .leftJoin(
      parentLinks,
      and(eq(parentLinks.studentId, users.id), eq(parentLinks.parentId, parentId)),
    )
    // Only a student can be a child here: a link row never makes any other role resettable by a
    // parent, even if roles ever change (A8 review hardening).
    .where(and(eq(users.id, childId), eq(users.role, "student")))
    .limit(1);
  const mode = row
    ? resetMode({
        linked: row.linkId !== null,
        source: row.source,
        parentId,
        createdByParentId: row.createdByParentId,
        dateOfBirth: row.dateOfBirth,
        emailVerifiedAt: row.emailVerifiedAt,
        now: clock.now(),
      })
    : "forbidden";
  return {
    mode,
    name: row?.name ?? "",
    email: row?.email ?? null,
    emailVerified: Boolean(row?.emailVerifiedAt),
    locale: row?.locale ?? null,
  };
}

export async function canParentSetPassword(parentId: string, childId: string): Promise<ResetMode> {
  return (await childFacts(db(), parentId, childId)).mode;
}

export type ResetChildPasswordResult =
  | { ok: true; mode: "direct" }
  | { ok: true; mode: "email"; maskedEmail: string }
  | {
      ok: false;
      reason: "forbidden" | "verifyFirst" | "invalid" | "no_verified_email" | "rateLimited";
    };

type ResetDecision =
  | { kind: "done"; result: ResetChildPasswordResult; sessionHashes: string[] }
  | { kind: "email"; facts: ChildFacts; email: string };

/**
 * Applies the matrix. Direct: argon2id hash, the child's sessions end, audit `{mode:"direct"}`
 * (the password itself is never audited). The facts read, the eligibility check, the credential
 * write and the session deletion are ONE transaction under the child's lock, so a child who
 * verifies an email or turns 18 meanwhile cannot be reset on stale facts. Email: a
 * `password_reset` code goes to the child's verified email through the normal send path, audit
 * `{mode:"email"}`; the caller only gets a mask.
 *
 * Both modes share one limit per parent and child, checked first (A8 code review). The argon2
 * hash is made only after a lock-free pre-check says the reset can be direct, so a refused or
 * email-mode request costs no hash; the transaction still decides on fresh facts.
 */
export async function resetChildPassword(
  input: { parentId: string; childId: string; newPassword?: string },
  ctx: { locale: Locale },
  deps: ParentDeps = {},
): Promise<ResetChildPasswordResult> {
  const { parentId, childId } = input;
  const guard = await guardParentReset({ parentId, childId }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "rateLimited" };
  const passwordHash = await directResetHash(parentId, childId, input.newPassword ?? "");

  const decision = await db().transaction(async (tx): Promise<ResetDecision> => {
    const refuse = (
      reason: "forbidden" | "verifyFirst" | "invalid" | "no_verified_email",
    ): ResetDecision => ({ kind: "done", result: { ok: false, reason }, sessionHashes: [] });
    await lock(tx, "student", childId);
    const state = await parentState(tx, parentId);
    if (state !== "ok") return refuse(state);
    const facts = await childFacts(tx, parentId, childId);
    if (facts.mode === "forbidden") return refuse("forbidden");

    if (facts.mode === "direct") {
      if (!passwordHash) return refuse("invalid");
      await setPasswordIn(tx, childId, passwordHash);
      await writeAudit(tx, {
        actorId: parentId,
        action: "parent.reset_password",
        subjectType: "user",
        subjectId: childId,
        after: { mode: "direct" },
      });
      const sessionHashes = await deleteUserSessionsIn(tx, childId);
      return { kind: "done", result: { ok: true, mode: "direct" }, sessionHashes };
    }

    if (!facts.email || !facts.emailVerified) return refuse("no_verified_email");
    return { kind: "email", facts, email: facts.email };
  });

  if (decision.kind === "done") {
    // The cache is purged only after the commit; a rolled-back reset leaves the sessions alone.
    await purgeSessionCache(childId, decision.sessionHashes);
    return decision.result;
  }

  await sendChildResetEmail({ parentId, childId, ...decision }, ctx, deps);
  return { ok: true, mode: "email", maskedEmail: maskEmail(decision.email) };
}

/** Email mode: audit `{mode:"email"}`, then a `password_reset` code to the child's verified email. */
async function sendChildResetEmail(
  input: { parentId: string; childId: string; facts: ChildFacts; email: string },
  ctx: { locale: Locale },
  deps: ParentDeps,
): Promise<void> {
  const { parentId, childId, facts, email } = input;
  await db().transaction(async (tx) => {
    await writeAudit(tx, {
      actorId: parentId,
      action: "parent.reset_password",
      subjectType: "user",
      subjectId: childId,
      after: { mode: "email" },
    });
  });
  const send = deps.sendCode ?? defaultSendCode;
  await send(
    { id: childId, name: facts.name, email, locale: facts.locale },
    "password_reset",
    ctx.locale,
  );
}

/**
 * The new password's hash when a direct reset looks possible (parent allowed, child direct-mode,
 * a valid length); null otherwise, without hashing. Lock-free: the caller re-checks in its
 * transaction.
 */
async function directResetHash(
  parentId: string,
  childId: string,
  password: string,
): Promise<string | null> {
  if (!isAcceptablePassword(password)) return null;
  if ((await parentState(db(), parentId)) !== "ok") return null;
  const facts = await childFacts(db(), parentId, childId);
  return facts.mode === "direct" ? hashPassword(password) : null;
}

// ---- Parent view ----

/**
 * What a parent may see of a child. `childId` is the handle the parent's own actions (reset,
 * unlink) need; no session, device, raw email, date of birth or number is ever returned.
 */
export type ChildCard = {
  childId: string;
  displayName: string;
  username: string | null;
  ageYears: number | null;
  maskedEmail: string | null;
  source: LinkSource;
  createdAt: Date;
};

export async function listChildrenForParent(parentId: string): Promise<ChildCard[]> {
  const now = clock.now();
  const rows = await db()
    .select({
      childId: users.id,
      displayName: users.name,
      username: users.username,
      dateOfBirth: users.dateOfBirth,
      email: users.email,
      source: parentLinks.source,
      createdAt: parentLinks.createdAt,
    })
    .from(parentLinks)
    .innerJoin(users, eq(users.id, parentLinks.studentId))
    .where(eq(parentLinks.parentId, parentId))
    .orderBy(asc(parentLinks.createdAt), asc(users.id));
  return rows.map((row) => ({
    childId: row.childId,
    displayName: row.displayName,
    username: row.username,
    ageYears: row.dateOfBirth ? ageOn(row.dateOfBirth, now) : null,
    maskedEmail: row.email ? maskEmail(row.email) : null,
    source: row.source,
    createdAt: row.createdAt,
  }));
}
