import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveKey } from "@/server/auth/keys";
import { setClockForTests } from "@/server/clock";
import * as schema from "@/server/db/schema";
import { MemoryLimiter } from "../../../../test/fake-limiter";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const dbSchema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  const conn = drizzle(client, { schema: dbSchema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => import("@/server/orders/test-fixtures").TestConn;
  closeTestDb: () => Promise<void>;
};
const conn = dbModule.db();
const { createUser } = await import("@/server/orders/test-fixtures");
const { applyAsTeacher } = await import("./apply");
const { decideTeacherApplication, listTeacherApplications } = await import("./review");
const { acceptTeacherTerms, canAuthor, currentTeacherTerms } = await import("./terms");
const { issueTeacherInvite, peekTeacherInvite, redeemTeacherInvite } = await import("./invites");
const { publicTeacherProfile, teacherOnboardingState } = await import("./profile");

const NOW = new Date("2030-05-01T09:00:00.000Z");
const PLACEHOLDER = "teacher-placeholder-1";
const ctx = { locale: "ar" as const, now: NOW };
let limiter = new MemoryLimiter();
const deps = () => ({ limiter, key: deriveKey("t".repeat(40), "rl") });

beforeEach(() => {
  setClockForTests(NOW);
  limiter = new MemoryLimiter();
});
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

const application = (over: Record<string, unknown> = {}) => ({
  name: "Mona Teacher",
  email: `apply-${crypto.randomUUID()}@example.test`,
  password: "Teacher-pass-1",
  date_of_birth: "1990-02-03",
  note: "I teach grade 10 physics in Amman.",
  ...over,
});

async function auditFor(action: string, subjectId: string) {
  return conn
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.subjectId, subjectId)));
}

async function profileOf(userId: string) {
  const [row] = await conn
    .select()
    .from(schema.teacherProfiles)
    .where(eq(schema.teacherProfiles.userId, userId));
  return row;
}

/** An application whose email is confirmed (approval needs that) unless `verified` is false. */
async function applied({ verified = true }: { verified?: boolean } = {}) {
  const result = await applyAsTeacher(application(), ctx);
  if (!result.ok) throw new Error(JSON.stringify(result));
  if (verified) {
    await conn
      .update(schema.users)
      .set({ emailVerifiedAt: NOW })
      .where(eq(schema.users.id, result.userId));
  }
  return result.userId;
}

describe("applyAsTeacher", () => {
  it("creates a teacher account in status applied, with the private note and an audit row", async () => {
    const userId = await applied({ verified: false });
    const [user] = await conn.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user).toMatchObject({ role: "teacher", emailVerifiedAt: null });
    expect(user?.publicNumber).toMatch(/^AN\d+$/);
    expect(await profileOf(userId)).toMatchObject({
      status: "applied",
      applicationNote: "I teach grade 10 physics in Amman.",
      publicName: { ar: "Mona Teacher" },
    });
    expect(await auditFor("teacher.applied", userId)).toHaveLength(1);
    expect((await listTeacherApplications()).some((row) => row.teacherId === userId)).toBe(true);
  });

  it("refuses minors, short notes and taken emails", async () => {
    expect(await applyAsTeacher(application({ date_of_birth: "2015-01-01" }), ctx)).toEqual({
      ok: false,
      code: "invalid",
      fields: ["date_of_birth"],
    });
    expect(await applyAsTeacher(application({ note: "short" }), ctx)).toMatchObject({
      fields: ["note"],
    });
    const taken = await createUser(conn, { role: "student" });
    expect(await applyAsTeacher(application({ email: taken.email }), ctx)).toEqual({
      ok: false,
      code: "duplicate",
    });
  });
});

describe("decideTeacherApplication", () => {
  it("approves once, with who and when, and refuses a second decision", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const teacherId = await applied();
    const result = await decideTeacherApplication({
      adminId: admin.id,
      teacherId,
      decision: "approve",
      reason: "",
    });
    expect(result).toMatchObject({ ok: true, recipient: { name: "Mona Teacher" } });
    expect(await profileOf(teacherId)).toMatchObject({
      status: "approved",
      decidedBy: admin.id,
      decidedAt: NOW,
      decisionReason: null,
    });
    expect(await auditFor("teacher.approved", teacherId)).toHaveLength(1);
    expect(
      await decideTeacherApplication({
        adminId: admin.id,
        teacherId,
        decision: "reject",
        reason: "x",
      }),
    ).toEqual({ ok: false, reason: "not_pending" });
  });

  it("refuses to approve an unconfirmed email, but a rejection still goes through", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const teacherId = await applied({ verified: false });
    const [listed] = (await listTeacherApplications()).filter((a) => a.teacherId === teacherId);
    expect(listed?.emailVerified).toBe(false);
    expect(
      await decideTeacherApplication({
        adminId: admin.id,
        teacherId,
        decision: "approve",
        reason: "",
      }),
    ).toEqual({ ok: false, reason: "unverified" });
    expect(await profileOf(teacherId)).toMatchObject({ status: "applied" });
    expect(
      await decideTeacherApplication({
        adminId: admin.id,
        teacherId,
        decision: "reject",
        reason: "Unknown applicant",
      }),
    ).toMatchObject({ ok: true });
  });

  it("a rejection needs a reason, which is stored and audited", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const teacherId = await applied();
    const base = { adminId: admin.id, teacherId, decision: "reject" as const };
    expect(await decideTeacherApplication({ ...base, reason: "  " })).toEqual({
      ok: false,
      reason: "reason_required",
    });
    expect(await decideTeacherApplication({ ...base, reason: "x".repeat(1001) })).toEqual({
      ok: false,
      reason: "reason_too_long",
    });
    expect(
      await decideTeacherApplication({ ...base, reason: "Need a teaching certificate." }),
    ).toMatchObject({
      ok: true,
    });
    expect(await profileOf(teacherId)).toMatchObject({
      status: "rejected",
      decisionReason: "Need a teaching certificate.",
    });
    const [audit] = await auditFor("teacher.rejected", teacherId);
    expect(audit?.after).toMatchObject({ reason: "Need a teaching certificate." });
    expect(
      await decideTeacherApplication({ ...base, teacherId: crypto.randomUUID(), reason: "x" }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("teacher terms and canAuthor", () => {
  it("authoring needs approval and the current terms; a new version asks again", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const teacherId = await applied();
    expect(await currentTeacherTerms()).toMatchObject({ id: PLACEHOLDER, isPlaceholder: true });
    expect(await acceptTeacherTerms(teacherId, PLACEHOLDER)).toEqual({
      ok: false,
      reason: "not_approved",
    });
    await decideTeacherApplication({
      adminId: admin.id,
      teacherId,
      decision: "approve",
      reason: "",
    });
    expect(await canAuthor(teacherId)).toBe(false);
    expect((await teacherOnboardingState(teacherId))?.termsToAccept?.id).toBe(PLACEHOLDER);
    expect(await acceptTeacherTerms(teacherId, "teacher-other")).toEqual({
      ok: false,
      reason: "stale_version",
    });
    expect(await acceptTeacherTerms(teacherId, PLACEHOLDER)).toEqual({ ok: true });
    expect(await canAuthor(teacherId)).toBe(true);
    expect((await teacherOnboardingState(teacherId))?.termsToAccept).toBeNull();
    const [audit] = await auditFor("teacher.terms_accepted", teacherId);
    expect(audit?.after).toEqual({ version: PLACEHOLDER });

    // A later version (published in the test's future) asks again once its time comes.
    const versionId = `teacher-test-${crypto.randomUUID()}`;
    await conn.insert(schema.termsVersions).values({
      id: versionId,
      kind: "teacher",
      body: { en: "New terms" },
      isPlaceholder: false,
      publishedAt: new Date(NOW.getTime() + 60_000),
    });
    expect(await canAuthor(teacherId)).toBe(true);
    setClockForTests(new Date(NOW.getTime() + 120_000));
    expect(await canAuthor(teacherId)).toBe(false);
    await conn.delete(schema.termsVersions).where(eq(schema.termsVersions.id, versionId));
  });
});

describe("teacher invites", () => {
  it("an invite creates an approved, verified teacher once; the link then dies", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const email = `invited-${crypto.randomUUID()}@example.test`;
    const issued = await issueTeacherInvite(
      { adminId: admin.id, name: "Omar Invited", email },
      deps(),
    );
    if (!issued.ok) throw new Error(issued.reason);
    expect(await peekTeacherInvite(issued.token)).toEqual({ name: "Omar Invited", email });
    const [stored] = await conn
      .select()
      .from(schema.teacherInvites)
      .where(eq(schema.teacherInvites.email, email));
    expect(stored?.tokenHash).not.toContain(issued.token);

    expect(
      await redeemTeacherInvite({
        token: issued.token,
        password: "short",
        dateOfBirth: "2020-01-01",
        locale: "en",
      }),
    ).toEqual({ ok: false, reason: "fields", fields: ["password", "date_of_birth"] });
    const redeemed = await redeemTeacherInvite({
      token: issued.token,
      password: "Invited-pass-1",
      dateOfBirth: "1988-08-08",
      locale: "en",
    });
    if (!redeemed.ok) throw new Error(redeemed.reason);
    const [user] = await conn
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, redeemed.userId));
    expect(user).toMatchObject({ role: "teacher", email, emailVerifiedAt: NOW });
    expect(await profileOf(redeemed.userId)).toMatchObject({
      status: "approved",
      decidedBy: admin.id,
    });
    const [redeemAudit] = await auditFor("teacher.invite_redeemed", redeemed.userId);
    // The invitee acted; the inviter is recorded beside them.
    expect(redeemAudit).toMatchObject({
      actorId: redeemed.userId,
      after: { status: "approved", invitedBy: admin.id },
    });
    expect(await peekTeacherInvite(issued.token)).toBeNull();
    expect(
      await redeemTeacherInvite({
        token: issued.token,
        password: "Invited-pass-1",
        dateOfBirth: "1988-08-08",
        locale: "en",
      }),
    ).toEqual({ ok: false, reason: "invalid_link" });
  });

  it("a new invite replaces the live one for the address", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const email = `reissued-${crypto.randomUUID()}@example.test`;
    const first = await issueTeacherInvite({ adminId: admin.id, name: "First", email }, deps());
    const second = await issueTeacherInvite({ adminId: admin.id, name: "Second", email }, deps());
    if (!first.ok || !second.ok) throw new Error("issue failed");
    expect(await peekTeacherInvite(first.token)).toBeNull();
    expect(await peekTeacherInvite(second.token)).toEqual({ name: "Second", email });
  });

  it("an address that signs up after the invite is reported as taken, and the invite stays", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const email = `raced-${crypto.randomUUID()}@example.test`;
    const issued = await issueTeacherInvite({ adminId: admin.id, name: "Raced", email }, deps());
    if (!issued.ok) throw new Error(issued.reason);
    const squatter = await createUser(conn, { role: "student" });
    await conn.update(schema.users).set({ email }).where(eq(schema.users.id, squatter.id));
    expect(
      await redeemTeacherInvite({
        token: issued.token,
        password: "Invited-pass-1",
        dateOfBirth: "1988-08-08",
        locale: "en",
      }),
    ).toEqual({ ok: false, reason: "taken" });
    // The transaction rolled back: the invite was not spent.
    expect(await peekTeacherInvite(issued.token)).toEqual({ name: "Raced", email });
  });

  it("refuses existing addresses and bad input, expires after 7 days, and is rate limited", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const existing = await createUser(conn, { role: "parent" });
    const issue = (email: string, name = "Some Teacher") =>
      issueTeacherInvite({ adminId: admin.id, name, email }, deps());
    expect(await issue(existing.email ?? "")).toEqual({ ok: false, reason: "exists" });
    expect(await issue("not-an-email")).toEqual({ ok: false, reason: "invalid" });
    expect(await issue(`x-${crypto.randomUUID()}@example.test`, "x")).toEqual({
      ok: false,
      reason: "invalid",
    });

    const late = await issue(`late-${crypto.randomUUID()}@example.test`);
    if (!late.ok) throw new Error(late.reason);
    setClockForTests(new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000));
    expect(await peekTeacherInvite(late.token)).toBeNull();
    setClockForTests(NOW);

    for (let i = 0; i < 18; i += 1) {
      expect((await issue(`bulk-${i}-${crypto.randomUUID()}@example.test`)).ok).toBe(true);
    }
    expect(await issue(`over-${crypto.randomUUID()}@example.test`)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
  });
});

describe("publicTeacherProfile", () => {
  it("shows approved teachers only, by public number, and nothing private", async () => {
    const admin = await createUser(conn, { role: "admin" });
    const teacherId = await applied();
    const [user] = await conn.select().from(schema.users).where(eq(schema.users.id, teacherId));
    const number = user?.publicNumber ?? "";
    expect(await publicTeacherProfile(number)).toBeNull();
    await decideTeacherApplication({
      adminId: admin.id,
      teacherId,
      decision: "approve",
      reason: "",
    });
    const profile = await publicTeacherProfile(number);
    expect(profile).toEqual({
      publicName: { ar: "Mona Teacher" },
      bio: {},
      isSample: false,
      courses: [],
    });
    expect(JSON.stringify(profile)).not.toMatch(/@|physics/);
    expect(await publicTeacherProfile("not a number!")).toBeNull();
  });
});
