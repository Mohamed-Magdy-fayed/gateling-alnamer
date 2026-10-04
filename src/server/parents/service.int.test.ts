import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import { setClockForTests } from "@/server/clock";
import { credentials, linkInvites, parentLinks, sessions, users } from "@/server/db/schema";
import { MemoryLimiter } from "../../../test/fake-limiter";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/auth/session-invalidate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session-invalidate")>();
  return { ...actual, deleteUserSessionsIn: vi.fn(actual.deleteUserSessionsIn) };
});
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 6, onnotice: () => {} });
  const conn = drizzle(client, { schema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const svc = await import("./service");
const {
  DAY,
  NOW,
  auditFor,
  childInput,
  createOk,
  ctx,
  db,
  deps,
  issueOk,
  link,
  makeUser,
  sendCode,
  registerParentTestHooks,
} = await import("./service.int-helpers");
const { supportContacts } = await import("@/server/devices/service");
registerParentTestHooks();

describe("createChild", () => {
  it("creates user, credential, public number, link, consent and audit in one go", async () => {
    const parent = await makeUser("parent");
    const input = childInput();
    const result = await svc.createChild(parent, input, ctx, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [child] = await db().select().from(users).where(eq(users.id, result.childId));
    expect(child?.role).toBe("student");
    expect(child?.createdByParentId).toBe(parent);
    expect(child?.guardianConsentAt?.toISOString()).toBe(NOW.toISOString());
    expect(child?.publicNumber).toMatch(/^AN\d{6}$/);
    expect(child?.email).toBeNull();
    const [cred] = await db()
      .select()
      .from(credentials)
      .where(eq(credentials.userId, result.childId));
    expect(cred?.passwordHash.startsWith("$argon2id$")).toBe(true);
    if (!cred) throw new Error("no credential");
    expect(await verifyPassword(String(input.password), cred)).toBe(true);
    const links = await db()
      .select()
      .from(parentLinks)
      .where(eq(parentLinks.studentId, result.childId));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ parentId: parent, source: "created_child" });
    const audit = await auditFor("parent.create_child", result.childId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(parent);
    expect(JSON.stringify(audit[0]?.after)).toContain("consent");
    expect(sendCode).not.toHaveBeenCalled();
  });

  it("takes no email: an email in the input is ignored and no code is sent", async () => {
    const parent = await makeUser("parent");
    const childId = await createOk(parent, { email: `kid-${crypto.randomUUID()}@example.test` });
    const [child] = await db().select().from(users).where(eq(users.id, childId));
    expect(child?.email).toBeNull();
    expect(child?.emailVerifiedAt).toBeNull();
    expect(sendCode).not.toHaveBeenCalled();
  });

  it("an unverified parent gets verifyFirst and nothing is created", async () => {
    const parent = await makeUser("parent", { emailVerifiedAt: null });
    const result = await svc.createChild(parent, childInput(), ctx, deps());
    expect(result).toEqual({ ok: false, code: "verifyFirst" });
    expect(
      await db().select().from(parentLinks).where(eq(parentLinks.parentId, parent)),
    ).toHaveLength(0);
  });

  it("three concurrent creations at 9 children let only one through", async () => {
    const parent = await makeUser("parent");
    for (let i = 0; i < 9; i += 1) {
      await link(parent, await makeUser("student"), "invite");
    }
    const results = await Promise.all([
      svc.createChild(parent, childInput(), ctx, deps()),
      svc.createChild(parent, childInput(), ctx, deps()),
      svc.createChild(parent, childInput(), ctx, deps()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "limitChildren")).toHaveLength(2);
    expect(
      await db().select().from(parentLinks).where(eq(parentLinks.parentId, parent)),
    ).toHaveLength(10);
  });

  it("rejects an adult, a future date, a weak password and a bad username", async () => {
    const parent = await makeUser("parent");
    for (const bad of [
      { date_of_birth: "2000-01-01" },
      { date_of_birth: "2031-01-01" },
      { password: "short" },
      { username: "admin" },
      { name: "" },
    ]) {
      const result = await svc.createChild(parent, childInput(bad), ctx, deps());
      expect(result).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("returns a generic duplicate for a taken username without creating anything", async () => {
    const parent = await makeUser("parent");
    const first = childInput();
    expect((await svc.createChild(parent, first, ctx, deps())).ok).toBe(true);
    const again = await svc.createChild(
      parent,
      childInput({ username: first.username }),
      ctx,
      deps(),
    );
    expect(again).toMatchObject({ ok: false, code: "duplicate" });
  });

  it("refuses a non-parent caller", async () => {
    const student = await makeUser("student");
    const result = await svc.createChild(student, childInput(), ctx, deps());
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("rejects the 11th child with limitChildren", async () => {
    const parent = await makeUser("parent");
    for (let i = 0; i < 10; i += 1) {
      const r = await svc.createChild(parent, childInput(), ctx, {
        ...deps(),
        limiter: new MemoryLimiter(),
      });
      expect(r.ok).toBe(true);
    }
    const eleventh = await svc.createChild(parent, childInput(), ctx, {
      ...deps(),
      limiter: new MemoryLimiter(),
    });
    expect(eleventh).toMatchObject({ ok: false, code: "limitChildren" });
  });

  it("rate-limits creation at 10 per day per parent", async () => {
    const parent = await makeUser("parent");
    for (let i = 0; i < 10; i += 1) {
      await svc.createChild(parent, childInput({ date_of_birth: "bad" }), ctx, deps());
    }
    const result = await svc.createChild(parent, childInput(), ctx, deps());
    expect(result).toMatchObject({ ok: false, code: "rateLimited" });
  });
});

describe("invites", () => {
  it("issues an 8-char code stored only as a keyed hash, expiring in 7 days", async () => {
    const parent = await makeUser("parent");
    const issued = await issueOk(parent);
    expect(issued.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(issued.expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
    const rows = await db().select().from(linkInvites).where(eq(linkInvites.parentId, parent));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).not.toContain(issued.code.replace("-", ""));
  });

  it("limits a parent to 5 active invites; expired ones do not count", async () => {
    const parent = await makeUser("parent");
    for (let i = 0; i < 5; i += 1) await issueOk(parent);
    expect(await svc.issueInvite(parent)).toMatchObject({ ok: false, code: "limitInvites" });
    setClockForTests(new Date(NOW.getTime() + 8 * DAY));
    expect((await svc.issueInvite(parent)).ok).toBe(true);
  });

  it("an unverified parent gets verifyFirst", async () => {
    const parent = await makeUser("parent", { emailVerifiedAt: null });
    expect(await svc.issueInvite(parent)).toEqual({ ok: false, code: "verifyFirst" });
  });

  it("three concurrent issues at 4 live codes let only one through", async () => {
    const parent = await makeUser("parent");
    for (let i = 0; i < 4; i += 1) await issueOk(parent);
    const results = await Promise.all([
      svc.issueInvite(parent),
      svc.issueInvite(parent),
      svc.issueInvite(parent),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "limitInvites")).toHaveLength(2);
    expect(
      await db().select().from(linkInvites).where(eq(linkInvites.parentId, parent)),
    ).toHaveLength(5);
  });

  it("refuses a non-parent issuer", async () => {
    const student = await makeUser("student");
    expect(await svc.issueInvite(student)).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("redeems once, links with source invite, audits, and rejects reuse", async () => {
    const parent = await makeUser("parent");
    const student = await makeUser("student");
    const other = await makeUser("student");
    const issued = await issueOk(parent);
    const typed = issued.code.toLowerCase().replace("-", " ");
    const result = await svc.redeemInvite(
      { studentId: student, code: typed, ip: "1.1.1.1" },
      deps(),
    );
    expect(result).toEqual({ ok: true, parentId: parent });
    const links = await db().select().from(parentLinks).where(eq(parentLinks.studentId, student));
    expect(links[0]).toMatchObject({ parentId: parent, source: "invite" });
    const audit = await auditFor("parent.link", student);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.after)).toContain("invite");
    const [invite] = await db().select().from(linkInvites).where(eq(linkInvites.parentId, parent));
    expect(invite?.redeemedBy).toBe(student);
    const reuse = await svc.redeemInvite(
      { studentId: other, code: issued.code, ip: "1.1.1.2" },
      deps(),
    );
    expect(reuse).toEqual({ ok: false, code: "invalid" });
  });

  it("gives one invalid result for wrong and expired codes", async () => {
    const parent = await makeUser("parent");
    const student = await makeUser("student");
    const issued = await issueOk(parent);
    const wrong = await svc.redeemInvite(
      { studentId: student, code: "ZZZZ-ZZZZ", ip: "2.2.2.2" },
      deps(),
    );
    setClockForTests(new Date(NOW.getTime() + 7 * DAY + 1000));
    const expired = await svc.redeemInvite(
      { studentId: student, code: issued.code, ip: "2.2.2.2" },
      deps(),
    );
    expect(wrong).toEqual({ ok: false, code: "invalid" });
    expect(expired).toEqual(wrong);
  });

  it("rejects a third parent with limitParents and leaves the code unused", async () => {
    const student = await makeUser("student");
    const p1 = await makeUser("parent");
    const p2 = await makeUser("parent");
    const p3 = await makeUser("parent");
    await link(p1, student, "invite");
    await link(p2, student, "created_child");
    const issued = await issueOk(p3);
    const result = await svc.redeemInvite(
      { studentId: student, code: issued.code, ip: "3.3.3.3" },
      deps(),
    );
    expect(result).toEqual({ ok: false, code: "limitParents" });
    const [invite] = await db().select().from(linkInvites).where(eq(linkInvites.parentId, p3));
    expect(invite?.redeemedAt).toBeNull();
  });

  it("rejects a redemption by a non-student and one that would give a parent 11 children", async () => {
    const parent = await makeUser("parent");
    const otherParent = await makeUser("parent");
    const issued = await issueOk(parent);
    expect(
      await svc.redeemInvite({ studentId: otherParent, code: issued.code, ip: "4.4.4.4" }, deps()),
    ).toEqual({ ok: false, code: "invalid" });
    for (let i = 0; i < 10; i += 1) await link(parent, await makeUser("student"), "invite");
    const student = await makeUser("student");
    expect(
      await svc.redeemInvite({ studentId: student, code: issued.code, ip: "4.4.4.5" }, deps()),
    ).toEqual({ ok: false, code: "limitChildren" });
  });

  it("rate-limits the 6th redemption attempt in 15 minutes, even with a right code", async () => {
    const parent = await makeUser("parent");
    const student = await makeUser("student");
    for (let i = 0; i < 5; i += 1) {
      const r = await svc.redeemInvite(
        { studentId: student, code: "ZZZZ-ZZZZ", ip: "5.5.5.5" },
        deps(),
      );
      expect(r).toEqual({ ok: false, code: "invalid" });
    }
    const issued = await issueOk(parent);
    const sixth = await svc.redeemInvite(
      { studentId: student, code: issued.code, ip: "5.5.5.5" },
      deps(),
    );
    expect(sixth).toEqual({ ok: false, code: "rateLimited" });
  });

  it("a code from a parent who is no longer verified is just invalid", async () => {
    const parent = await makeUser("parent");
    const student = await makeUser("student");
    const issued = await issueOk(parent);
    await db().update(users).set({ emailVerifiedAt: null }).where(eq(users.id, parent));
    expect(
      await svc.redeemInvite({ studentId: student, code: issued.code, ip: "6.6.6.9" }, deps()),
    ).toEqual({ ok: false, code: "invalid" });
  });

  it("one student redeeming two different codes in parallel never reaches 3 parents", async () => {
    const first = await makeUser("parent");
    const second = await makeUser("parent");
    const third = await makeUser("parent");
    const student = await makeUser("student");
    await link(first, student, "invite");
    const codes = [await issueOk(second), await issueOk(third)];
    const results = await Promise.all(
      codes.map((issued, i) =>
        svc.redeemInvite({ studentId: student, code: issued.code, ip: `6.6.7.${i}` }, deps()),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "limitParents")).toHaveLength(1);
    expect(
      await db().select().from(parentLinks).where(eq(parentLinks.studentId, student)),
    ).toHaveLength(2);
  });

  it("lets only one of two concurrent redeemers win", async () => {
    const parent = await makeUser("parent");
    const a = await makeUser("student");
    const b = await makeUser("student");
    const issued = await issueOk(parent);
    const results = await Promise.all([
      svc.redeemInvite({ studentId: a, code: issued.code, ip: "6.6.6.1" }, deps()),
      svc.redeemInvite({ studentId: b, code: issued.code, ip: "6.6.6.2" }, deps()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("unlinkParent", () => {
  it("lets the parent, the student or an admin unlink an invite link, and audits the actor", async () => {
    const parent = await makeUser("parent");
    const admin = await makeUser("admin");
    for (const who of ["parent", "student", "admin"] as const) {
      const student = await makeUser("student");
      await link(parent, student, "invite");
      const actorId = who === "parent" ? parent : who === "student" ? student : admin;
      const result = await svc.unlinkParent({
        actor: { id: actorId, role: who },
        parentId: parent,
        studentId: student,
      });
      expect(result).toEqual({ ok: true });
      expect(
        await db().select().from(parentLinks).where(eq(parentLinks.studentId, student)),
      ).toHaveLength(0);
      const audit = await auditFor("parent.unlink", student);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actorId).toBe(actorId);
    }
  });

  it("never lets the parent, and lets the student only once 18 or verified, unlink a created_child link", async () => {
    const parent = await makeUser("parent");
    const admin = await makeUser("admin");
    const student = await makeUser("student", { emailVerifiedAt: null });
    await link(parent, student, "created_child");
    for (const actor of [
      { id: parent, role: "parent" as const },
      { id: student, role: "student" as const },
    ]) {
      expect(await svc.unlinkParent({ actor, parentId: parent, studentId: student })).toEqual({
        ok: false,
        reason: "forbidden",
      });
    }
    expect(
      await svc.unlinkParent({
        actor: { id: admin, role: "admin" },
        parentId: parent,
        studentId: student,
      }),
    ).toEqual({ ok: true });
  });

  it("a created child who is 18 or has a verified email may unlink; the audit actor is the student", async () => {
    const parent = await makeUser("parent");
    const adult = await makeUser("student", { emailVerifiedAt: null, dateOfBirth: "2000-01-01" });
    const verified = await makeUser("student", { dateOfBirth: "2015-01-01" });
    const stillMinor = await makeUser("student", { emailVerifiedAt: null });
    for (const child of [adult, verified, stillMinor]) {
      await db().update(users).set({ createdByParentId: parent }).where(eq(users.id, child));
      await link(parent, child, "created_child");
    }
    for (const child of [adult, verified]) {
      expect(
        await svc.unlinkParent({
          actor: { id: child, role: "student" },
          parentId: parent,
          studentId: child,
        }),
      ).toEqual({ ok: true });
      const audit = await auditFor("parent.unlink", child);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actorId).toBe(child);
    }
    expect(
      await svc.unlinkParent({
        actor: { id: stillMinor, role: "student" },
        parentId: parent,
        studentId: stillMinor,
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("refuses a stranger and reports a missing link", async () => {
    const parent = await makeUser("parent");
    const stranger = await makeUser("parent");
    const student = await makeUser("student");
    await link(parent, student, "invite");
    expect(
      await svc.unlinkParent({
        actor: { id: stranger, role: "parent" },
        parentId: parent,
        studentId: student,
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await svc.unlinkParent({
        actor: { id: stranger, role: "parent" },
        parentId: stranger,
        studentId: student,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("listChildrenForParent", () => {
  it("returns only the allowed fields for each child, with a masked email", async () => {
    const parent = await makeUser("parent");
    const rawEmail = `k-${crypto.randomUUID()}@example.test`;
    const child = await makeUser("student", {
      email: rawEmail,
      username: `kid_${Math.random().toString(36).slice(2, 8)}`,
      dateOfBirth: "2018-03-01",
    });
    await link(parent, child, "invite");
    await db()
      .insert(sessions)
      .values({
        tokenHash: crypto.randomUUID(),
        userId: child,
        expiresAt: new Date(NOW.getTime() + DAY),
      });
    const list = await svc.listChildrenForParent(parent);
    expect(list).toHaveLength(1);
    const [item] = list;
    expect(Object.keys(item ?? {}).sort()).toEqual(
      [
        "ageYears",
        "childId",
        "createdAt",
        "displayName",
        "maskedEmail",
        "source",
        "username",
      ].sort(),
    );
    expect(item).toMatchObject({
      childId: child,
      ageYears: 12,
      maskedEmail: "k***@example.test",
      source: "invite",
    });
    expect(JSON.stringify(item)).not.toContain(rawEmail);
  });

  it("returns a null mask for a child without email and lists only this parent's children", async () => {
    const parent = await makeUser("parent");
    const other = await makeUser("parent");
    await createOk(parent);
    await createOk(other);
    const list = await svc.listChildrenForParent(parent);
    expect(list).toHaveLength(1);
    expect(list[0]?.maskedEmail).toBeNull();
  });
});

describe("supportContacts carry-over", () => {
  it("also returns linked parents' verified emails, never unverified or unlinked ones", async () => {
    const student = await makeUser("student");
    const verified = await makeUser("parent");
    const unverified = await makeUser("parent", { emailVerifiedAt: null });
    const stranger = await makeUser("parent");
    await link(verified, student, "invite");
    await link(unverified, student, "invite");
    const emailOf = async (id: string) =>
      (await db().select({ email: users.email }).from(users).where(eq(users.id, id)))[0]?.email;
    const emails = (await supportContacts(student)).map((c) => c.email);
    expect(emails).toContain(await emailOf(verified));
    expect(emails).not.toContain(await emailOf(unverified));
    expect(emails).not.toContain(await emailOf(stranger));
  });
});
