import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import * as schema from "@/server/db/schema";
import { MemoryLimiter } from "../../../test/fake-limiter";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example", APP_MODE: "demo" }),
}));
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
const details = await import("./details");
const { ibanKeyring } = await import("./payout-crypto");
const { hashPassword, randomToken, sha256 } = await import("@/server/auth/password");
const { createUser } = await import("@/server/orders/test-fixtures");

const NOW = new Date("2030-07-01T09:00:00.000Z");
const PASSWORD = "Correct-horse-9";
const IBAN = "AE070331234567890123456";
const OTHER_IBAN = "SA0380000000608010167519";
const ring = ibanKeyring({ IBAN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") });
const deps = () => ({ ring, limiter: new MemoryLimiter() });

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

async function withPassword(userId: string) {
  await conn
    .insert(schema.credentials)
    .values({ userId, passwordHash: await hashPassword(PASSWORD) });
}

async function teacher(status: "applied" | "approved" | "suspended" = "approved") {
  const user = await createUser(conn, { role: "teacher" });
  await withPassword(user.id);
  await conn.insert(schema.teacherProfiles).values({
    userId: user.id,
    publicName: { en: "Teacher" },
    bio: { en: "Bio" },
    status,
  });
  return user;
}

async function admin(options: { superAdmin: boolean; verified?: boolean; reauthAt?: Date | null }) {
  const user = await createUser(conn, { role: "admin" });
  await conn
    .update(schema.users)
    .set({ isSuperAdmin: options.superAdmin })
    .where(eq(schema.users.id, user.id));
  const tokenHash = sha256(randomToken());
  await conn.insert(schema.sessions).values({
    tokenHash,
    userId: user.id,
    twoFactorVerified: options.verified ?? true,
    reauthAt: options.reauthAt === undefined ? NOW : options.reauthAt,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  return { user, tokenHash };
}

const input = (teacherId: string, overrides: Partial<Record<string, string>> = {}) => ({
  teacherId,
  holderName: "Mona Ahmed",
  bankName: "Emirates NBD",
  iban: "ae07 0331 2345 6789 0123 456",
  currentPassword: PASSWORD,
  ...overrides,
});

async function auditRows(subjectId: string, action: string) {
  return conn
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.subjectId, subjectId), eq(schema.auditLog.action, action)));
}

describe("setPayoutDetails", () => {
  it("seals the IBAN, keeps the last 4 and the key version, and audits without the IBAN", async () => {
    const t = await teacher();
    const result = await details.setPayoutDetails(input(t.id), deps());
    expect(result).toMatchObject({ ok: true });

    const [row] = await conn
      .select()
      .from(schema.teacherPayoutDetails)
      .where(eq(schema.teacherPayoutDetails.userId, t.id));
    expect(row).toMatchObject({
      ibanLast4: "3456",
      ibanCountry: "AE",
      holderName: "Mona Ahmed",
      bankName: "Emirates NBD",
      keyVersion: 1,
    });
    expect(row?.ibanCiphertext).not.toContain(IBAN);
    expect(row?.ibanCiphertext).toMatch(/^v1\./);

    const [audit] = await auditRows(t.id, "payout_details.set");
    expect(audit?.after).toEqual({
      ibanLast4: "3456",
      ibanCountry: "AE",
      keyVersion: 1,
      holderName: "Mona Ahmed",
      bankName: "Emirates NBD",
    });
    expect(audit?.before).toBeNull();
    const text = JSON.stringify(audit);
    expect(text).not.toContain(IBAN);
    expect(text).not.toContain(row?.ibanCiphertext ?? "missing");
  });

  it("replaces earlier details; the audit keeps the old last 4", async () => {
    const t = await teacher("applied");
    await details.setPayoutDetails(input(t.id), deps());
    setClockForTests(new Date(NOW.getTime() + 60_000));
    const result = await details.setPayoutDetails(
      input(t.id, { iban: OTHER_IBAN, bankName: "Al Rajhi" }),
      deps(),
    );
    expect(result).toMatchObject({ ok: true });
    const view = await details.getPayoutDetailsView(t.id);
    expect(view).toMatchObject({ ibanLast4: "7519", ibanCountry: "SA", bankName: "Al Rajhi" });
    expect(view?.updatedAt).toEqual(new Date(NOW.getTime() + 60_000));
    const rows = await auditRows(t.id, "payout_details.set");
    expect(rows).toHaveLength(2);
    expect(
      rows.some((r) => (r.before as { ibanLast4?: string } | null)?.ibanLast4 === "3456"),
    ).toBe(true);
  });

  it("names what is wrong with the IBAN, the names or the password", async () => {
    const t = await teacher();
    const set = (overrides: Partial<Record<string, string>>) =>
      details.setPayoutDetails(input(t.id, overrides), deps());
    expect(await set({ iban: "GB82WEST12345698765432" })).toEqual({
      ok: false,
      reason: "iban_country",
    });
    expect(await set({ iban: `${IBAN}1` })).toEqual({ ok: false, reason: "iban_length" });
    expect(await set({ iban: "AE080331234567890123456" })).toEqual({
      ok: false,
      reason: "iban_checksum",
    });
    expect(await set({ iban: "not an iban" })).toEqual({ ok: false, reason: "iban_format" });
    expect(await set({ holderName: " ‏ " })).toEqual({ ok: false, reason: "holder" });
    expect(await set({ bankName: "b".repeat(101) })).toEqual({ ok: false, reason: "bank" });
    expect(await set({ currentPassword: "Wrong-password-1" })).toEqual({
      ok: false,
      reason: "password",
    });
    expect(await details.getPayoutDetailsView(t.id)).toBeNull();
  });

  it("strips hidden characters from the names", async () => {
    const t = await teacher();
    await details.setPayoutDetails(input(t.id, { holderName: "‮Mona\u0000 " }), deps());
    expect(await details.getPayoutDetailsView(t.id)).toMatchObject({ holderName: "Mona" });
  });

  it("is only for teachers who are not suspended", async () => {
    const student = await createUser(conn, { role: "student" });
    await withPassword(student.id);
    expect(await details.setPayoutDetails(input(student.id), deps())).toEqual({
      ok: false,
      reason: "not_teacher",
    });
    const suspended = await teacher("suspended");
    expect(await details.setPayoutDetails(input(suspended.id), deps())).toEqual({
      ok: false,
      reason: "not_teacher",
    });
  });

  it("allows 10 saves a day", async () => {
    const t = await teacher();
    const d = deps();
    for (let i = 0; i < 10; i += 1) {
      expect(await details.setPayoutDetails(input(t.id), d)).toMatchObject({ ok: true });
    }
    expect(await details.setPayoutDetails(input(t.id), d)).toEqual({
      ok: false,
      reason: "limited",
    });
  });
});

describe("reads for teachers and admins", () => {
  it("never carry the ciphertext or the full IBAN", async () => {
    const t = await teacher();
    await details.setPayoutDetails(input(t.id), deps());
    const [row] = await conn
      .select({ c: schema.teacherPayoutDetails.ibanCiphertext })
      .from(schema.teacherPayoutDetails)
      .where(eq(schema.teacherPayoutDetails.userId, t.id));
    const view = await details.getPayoutDetailsView(t.id);
    const list = await details.listPayoutDetailsForAdmin();
    expect(list.find((item) => item.teacherId === t.id)).toMatchObject({
      ibanLast4: "3456",
      holderName: "Mona Ahmed",
      teacherName: "teacher user",
    });
    for (const value of [view, list]) {
      const text = JSON.stringify(value);
      expect(text).not.toContain(IBAN);
      expect(text).not.toContain(row?.c ?? "missing");
      expect(text).not.toMatch(/ciphertext|keyVersion/i);
    }
  });
});

describe("revealIban", () => {
  it("gives a super admin with a fresh re-auth the IBAN and audits last 4 + key version", async () => {
    const t = await teacher();
    await details.setPayoutDetails(input(t.id), deps());
    const a = await admin({ superAdmin: true });
    const result = await details.revealIban(
      { actorId: a.user.id, sessionTokenHash: a.tokenHash, teacherId: t.id },
      deps(),
    );
    expect(result).toEqual({ ok: true, iban: IBAN });
    const [audit] = await auditRows(t.id, "payout_details.revealed");
    expect(audit?.actorId).toBe(a.user.id);
    expect(audit?.after).toEqual({ ibanLast4: "3456", keyVersion: 1 });
    expect(JSON.stringify(audit)).not.toContain(IBAN);
  });

  it("refuses an admin who is not a super admin, and a session without two-factor", async () => {
    const t = await teacher();
    await details.setPayoutDetails(input(t.id), deps());
    const plain = await admin({ superAdmin: false });
    const reveal = (actorId: string, sessionTokenHash: string) =>
      details.revealIban({ actorId, sessionTokenHash, teacherId: t.id }, deps());
    expect(await reveal(plain.user.id, plain.tokenHash)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    const unverified = await admin({ superAdmin: true, verified: false });
    expect(await reveal(unverified.user.id, unverified.tokenHash)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    const other = await admin({ superAdmin: true });
    expect(await reveal(other.user.id, plain.tokenHash)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await auditRows(t.id, "payout_details.revealed")).toHaveLength(0);
  });

  it("asks for a re-auth when there is none or it is older than 5 minutes", async () => {
    const t = await teacher();
    await details.setPayoutDetails(input(t.id), deps());
    const none = await admin({ superAdmin: true, reauthAt: null });
    const stale = await admin({ superAdmin: true, reauthAt: new Date(NOW.getTime() - 300_001) });
    for (const a of [none, stale]) {
      expect(
        await details.revealIban(
          { actorId: a.user.id, sessionTokenHash: a.tokenHash, teacherId: t.id },
          deps(),
        ),
      ).toEqual({ ok: false, reason: "reauth" });
    }
  });

  it("reports a teacher without details, refuses a moved ciphertext and limits reveals", async () => {
    const a = await admin({ superAdmin: true });
    const d = deps();
    const reveal = (teacherId: string) =>
      details.revealIban({ actorId: a.user.id, sessionTokenHash: a.tokenHash, teacherId }, d);
    const empty = await teacher();
    expect(await reveal(empty.id)).toEqual({ ok: false, reason: "not_found" });

    const alice = await teacher();
    const bob = await teacher();
    await details.setPayoutDetails(input(alice.id), deps());
    await details.setPayoutDetails(input(bob.id, { iban: OTHER_IBAN }), deps());
    const [aliceRow] = await conn
      .select()
      .from(schema.teacherPayoutDetails)
      .where(eq(schema.teacherPayoutDetails.userId, alice.id));
    await conn
      .update(schema.teacherPayoutDetails)
      .set({ ibanCiphertext: aliceRow?.ibanCiphertext })
      .where(eq(schema.teacherPayoutDetails.userId, bob.id));
    expect(await reveal(bob.id)).toEqual({ ok: false, reason: "unreadable" });

    for (let i = 0; i < 28; i += 1) await reveal(alice.id);
    expect(await reveal(alice.id)).toEqual({ ok: false, reason: "limited" });
  });
});
