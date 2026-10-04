import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import { credentials, sessions, users } from "@/server/db/schema";

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
  createOk,
  ctx,
  db,
  deps,
  link,
  makeUser,
  sendCode,
  registerParentTestHooks,
} = await import("./service.int-helpers");
const invalidate = await import("@/server/auth/session-invalidate");
const { guardCodeSend } = await import("@/server/auth/abuse");
registerParentTestHooks();

describe("canParentSetPassword matrix (D35)", () => {
  it("no link -> forbidden", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student");
    expect(await svc.canParentSetPassword(parent, child)).toBe("forbidden");
  });

  it("created by this parent, under 18, no verified email -> direct", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student", { createdByParentId: parent, emailVerifiedAt: null });
    await link(parent, child, "created_child");
    expect(await svc.canParentSetPassword(parent, child)).toBe("direct");
  });

  it("created by this parent but now 18 -> email", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student", {
      createdByParentId: parent,
      emailVerifiedAt: null,
      dateOfBirth: "2000-01-01",
    });
    await link(parent, child, "created_child");
    expect(await svc.canParentSetPassword(parent, child)).toBe("email");
  });

  it("created by this parent but the child verified an email -> email", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student", { createdByParentId: parent });
    await link(parent, child, "created_child");
    expect(await svc.canParentSetPassword(parent, child)).toBe("email");
  });

  it("invite link, under 18, no verified email -> direct", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student", { emailVerifiedAt: null });
    await link(parent, child, "invite");
    expect(await svc.canParentSetPassword(parent, child)).toBe("direct");
  });

  it("invite link, under 18, verified email -> email", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student");
    await link(parent, child, "invite");
    expect(await svc.canParentSetPassword(parent, child)).toBe("email");
  });

  it("invite link, an adult -> email", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student", { dateOfBirth: "2000-01-01", emailVerifiedAt: null });
    await link(parent, child, "invite");
    expect(await svc.canParentSetPassword(parent, child)).toBe("email");
  });
});

describe("resetChildPassword", () => {
  it("direct: stores argon2id, ends the child's sessions, audits mode direct", async () => {
    const parent = await makeUser("parent");
    const childId = await createOk(parent);
    await db()
      .insert(sessions)
      .values({
        tokenHash: crypto.randomUUID(),
        userId: childId,
        expiresAt: new Date(NOW.getTime() + DAY),
      });
    const result = await svc.resetChildPassword(
      { parentId: parent, childId, newPassword: "Brand-new-pass-9" },
      ctx,
      deps(),
    );
    expect(result).toEqual({ ok: true, mode: "direct" });
    const [cred] = await db().select().from(credentials).where(eq(credentials.userId, childId));
    expect(cred?.passwordHash.startsWith("$argon2id$")).toBe(true);
    if (!cred) throw new Error("no credential");
    expect(await verifyPassword("Brand-new-pass-9", cred)).toBe(true);
    expect(await db().select().from(sessions).where(eq(sessions.userId, childId))).toHaveLength(0);
    const audit = await auditFor("parent.reset_password", childId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(parent);
    expect(JSON.stringify(audit[0]?.after)).toContain("direct");
    expect(JSON.stringify(audit)).not.toContain("Brand-new-pass-9");
  });

  it("direct: rejects a weak password without changing anything", async () => {
    const parent = await makeUser("parent");
    const childId = await createOk(parent);
    const result = await svc.resetChildPassword(
      { parentId: parent, childId, newPassword: "short" },
      ctx,
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(await auditFor("parent.reset_password", childId)).toHaveLength(0);
  });

  it("email: issues a password_reset code to the child's email, returns a mask, audits mode email", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student", { email: `k-${crypto.randomUUID()}@example.test` });
    await link(parent, child, "invite");
    const result = await svc.resetChildPassword({ parentId: parent, childId: child }, ctx, deps());
    expect(result).toEqual({ ok: true, mode: "email", maskedEmail: "k***@example.test" });
    expect(sendCode).toHaveBeenCalledWith(
      expect.objectContaining({ id: child }),
      "password_reset",
      "en",
    );
    const audit = await auditFor("parent.reset_password", child);
    expect(JSON.stringify(audit[0]?.after)).toContain("email");
  });

  it("direct: rolls the password back when ending the sessions fails", async () => {
    const parent = await makeUser("parent");
    const childId = await createOk(parent);
    const before = await db().select().from(credentials).where(eq(credentials.userId, childId));
    vi.mocked(invalidate.deleteUserSessionsIn).mockRejectedValueOnce(new Error("boom"));
    await expect(
      svc.resetChildPassword(
        { parentId: parent, childId, newPassword: "Brand-new-pass-9" },
        ctx,
        deps(),
      ),
    ).rejects.toThrow("boom");
    expect(await db().select().from(credentials).where(eq(credentials.userId, childId))).toEqual(
      before,
    );
    expect(await auditFor("parent.reset_password", childId)).toHaveLength(0);
  });

  it("email: the parent's resets use their own budget, apart from the child's self-serve one", async () => {
    const parent = await makeUser("parent");
    const email = `k-${crypto.randomUUID()}@example.test`;
    const child = await makeUser("student", { email });
    await link(parent, child, "invite");
    // The child burns the whole self-serve reset budget for their address.
    for (let i = 0; i < 3; i++)
      await guardCodeSend({ identifier: email, ip: "198.51.100.7" }, deps());
    expect(await guardCodeSend({ identifier: email, ip: "198.51.100.7" }, deps())).toMatchObject({
      blocked: "rateLimited",
    });
    const viaParent = await svc.resetChildPassword(
      { parentId: parent, childId: child },
      ctx,
      deps(),
    );
    expect(viaParent).toMatchObject({ ok: true, mode: "email" });
  });

  it("direct: shares the per parent and child limit with email resets (A8.10)", async () => {
    const parent = await makeUser("parent");
    const childId = await createOk(parent);
    for (let i = 0; i < 3; i++) {
      const done = await svc.resetChildPassword(
        { parentId: parent, childId, newPassword: `Brand-new-pass-${i}` },
        ctx,
        deps(),
      );
      expect(done).toEqual({ ok: true, mode: "direct" });
    }
    expect(
      await svc.resetChildPassword(
        { parentId: parent, childId, newPassword: "Brand-new-pass-x" },
        ctx,
        deps(),
      ),
    ).toEqual({ ok: false, reason: "rateLimited" });
  });

  it("email: parent resets cannot burn the child's self-serve budget", async () => {
    const parent = await makeUser("parent");
    const email = `k-${crypto.randomUUID()}@example.test`;
    const child = await makeUser("student", { email });
    await link(parent, child, "invite");
    for (let i = 0; i < 3; i++) {
      const done = await svc.resetChildPassword({ parentId: parent, childId: child }, ctx, deps());
      expect(done).toMatchObject({ ok: true, mode: "email" });
    }
    expect(await svc.resetChildPassword({ parentId: parent, childId: child }, ctx, deps())).toEqual(
      {
        ok: false,
        reason: "rateLimited",
      },
    );
    expect(await guardCodeSend({ identifier: email, ip: "198.51.100.8" }, deps())).toEqual({
      ok: true,
    });
  });

  it("an adult created child gets no_verified_email, never a direct write", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student", {
      createdByParentId: parent,
      emailVerifiedAt: null,
      dateOfBirth: "2000-01-01",
    });
    await link(parent, child, "created_child");
    const before = await db().select().from(credentials).where(eq(credentials.userId, child));
    const result = await svc.resetChildPassword(
      { parentId: parent, childId: child, newPassword: "Brand-new-pass-9" },
      ctx,
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "no_verified_email" });
    expect(await db().select().from(credentials).where(eq(credentials.userId, child))).toEqual(
      before,
    );
  });

  it("an unverified parent gets verifyFirst", async () => {
    const parent = await makeUser("parent", { emailVerifiedAt: null });
    const childId = await createOk(await makeUser("parent"));
    await link(parent, childId, "invite");
    const result = await svc.resetChildPassword(
      { parentId: parent, childId, newPassword: "Brand-new-pass-9" },
      ctx,
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "verifyFirst" });
  });

  it("re-reads the facts under the student lock: a child who verified meanwhile is not reset directly", async () => {
    const parent = await makeUser("parent");
    const childId = await createOk(parent);
    await db()
      .update(users)
      .set({ email: `late-${crypto.randomUUID()}@example.test` })
      .where(eq(users.id, childId));
    const before = await db().select().from(credentials).where(eq(credentials.userId, childId));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => {};
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const verifier = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`student-links:${childId}`}))`);
      await tx.update(users).set({ emailVerifiedAt: NOW }).where(eq(users.id, childId));
      held();
      await gate;
    });
    await holding;
    let settled = false;
    const reset = svc
      .resetChildPassword(
        { parentId: parent, childId, newPassword: "Brand-new-pass-9" },
        ctx,
        deps(),
      )
      .then((r) => {
        settled = true;
        return r;
      });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).toBe(false);
    release();
    await verifier;
    const result = await reset;
    expect(result).toMatchObject({ ok: true, mode: "email" });
    expect(await db().select().from(credentials).where(eq(credentials.userId, childId))).toEqual(
      before,
    );
  });

  it("forbidden without a link, and nothing is audited", async () => {
    const parent = await makeUser("parent");
    const child = await makeUser("student");
    const result = await svc.resetChildPassword(
      { parentId: parent, childId: child, newPassword: "Brand-new-pass-9" },
      ctx,
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(await auditFor("parent.reset_password", child)).toHaveLength(0);
  });

  it("forbidden for a linked account that is not a student (A8 hardening)", async () => {
    const parent = await makeUser("parent");
    const childId = await createOk(parent);
    await db().update(users).set({ role: "teacher" }).where(eq(users.id, childId));
    const result = await svc.resetChildPassword(
      { parentId: parent, childId, newPassword: "Brand-new-pass-9" },
      ctx,
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(await auditFor("parent.reset_password", childId)).toHaveLength(0);
  });
});
